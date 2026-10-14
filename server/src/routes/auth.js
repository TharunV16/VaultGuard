// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { createHmac, randomBytes } from 'node:crypto';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { Challenge } from '../models/Challenge.js';
import { hashAuthKey, verifyAuthKey, hashRecoveryVerifier, safeEqual, randomHex } from '../../lib/crypto.js';
import { issueAccessToken, generateRefreshToken, hashRefreshToken } from '../../lib/tokens.js';
import { logAudit, getCoarseIp, getDeviceLabel } from '../../lib/audit.js';
import { sendMail } from '../../lib/mail.js';
import { config } from '../config.js';
import { authLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ── Prelogin (Decoy params for unknown emails per AUTH-03) ───────────────────
const PreloginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

router.post('/prelogin', authLimiter, validate(PreloginSchema), async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (user) {
    return res.json({ kdf: user.kdf });
  }

  // Generate deterministic decoy salt using HMAC(DECOY_SECRET, email)
  const decoySalt = createHmac('sha256', config.DECOY_SECRET)
    .update(email)
    .digest('hex')
    .slice(0, 32);

  // Perform dummy computation to match timing of real user lookup
  await verifyAuthKey(
    '00'.repeat(32),
    decoySalt,
    '00'.repeat(32)
  ).catch(() => {});

  return res.json({
    kdf: {
      algo: 'PBKDF2-SHA256',
      iterations: 600000,
      salt: decoySalt,
    },
  });
});

// ── Register (AUTH-01) ────────────────────────────────────────────────────────
const RegisterSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  authKey: z.string().regex(/^[0-9a-f]{64}$/i),
  kdf: z.object({
    algo: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().min(600000),
    salt: z.string().regex(/^[0-9a-f]{32}$/i),
  }),
  wrappedVaultKey: z.object({
    iv: z.string().regex(/^[0-9a-f]{24}$/i),
    ct: z.string().regex(/^[0-9a-f]+$/i),
  }),
  recoveryWrappedVaultKey: z.object({
    iv: z.string().regex(/^[0-9a-f]{24}$/i),
    ct: z.string().regex(/^[0-9a-f]+$/i),
  }),
  recoveryVerifier: z.string().regex(/^[0-9a-f]{64}$/i),
});

router.post('/register', registerLimiter, validate(RegisterSchema), async (req, res) => {
  const {
    email,
    authKey,
    kdf,
    wrappedVaultKey,
    recoveryWrappedVaultKey,
    recoveryVerifier,
  } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    // Generic 202 to prevent user enumeration
    sendMail({
      to: email,
      subject: 'Security Alert: Registration attempted',
      text: 'A registration attempt was made using your email address. If this was you, you can log in or reset your password.',
    }).catch(() => {});
    return res.status(202).json({
      message: 'If the email is valid and unverified, instructions have been sent.',
    });
  }

  const authHash = await hashAuthKey(authKey);
  const recoveryVerifierHash = hashRecoveryVerifier(recoveryVerifier);

  const user = await User.create({
    email,
    kdf,
    authHash,
    wrappedVaultKey,
    recoveryWrappedVaultKey,
    recoveryVerifierHash,
    role: config.ADMIN_EMAIL && email === config.ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user',
  });

  // Create verification code
  const verifyCode = randomBytes(4).toString('hex').toUpperCase(); // 8-char code
  const codeHash = createHmac('sha256', config.DECOY_SECRET).update(verifyCode).digest('hex');

  await Challenge.create({
    userId: user._id,
    purpose: 'email_verify',
    codeHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  });

  await sendMail({
    to: email,
    subject: 'Verify your VaultGuard account',
    text: `Your VaultGuard verification code is: ${verifyCode}\nIt expires in 24 hours.`,
  });

  await logAudit({ userId: user._id, event: 'auth.register', req });

  res.status(202).json({
    message: 'Registration received. Please check your email to verify your account.',
  });
});

// ── Verify Email (AUTH-07) ───────────────────────────────────────────────────
const VerifyEmailSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  code: z.string().trim().min(4).max(64),
});

router.post('/verify-email', registerLimiter, validate(VerifyEmailSchema), async (req, res) => {
  const { email, code } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(400).json({ error: { code: 'INVALID_CODE', message: 'Invalid or expired verification code' } });
  }

  const codeHash = createHmac('sha256', config.DECOY_SECRET).update(code.toUpperCase()).digest('hex');
  const challenge = await Challenge.findOne({
    userId: user._id,
    purpose: 'email_verify',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!challenge || !safeEqual(challenge.codeHash, codeHash)) {
    return res.status(400).json({ error: { code: 'INVALID_CODE', message: 'Invalid or expired verification code' } });
  }

  challenge.usedAt = new Date();
  await challenge.save();

  user.emailVerified = true;
  await user.save();

  await logAudit({ userId: user._id, event: 'auth.email_verified', req });
  res.json({ status: 'ok', message: 'Email verified successfully' });
});

// ── Login (AUTH-04, lockout, MFA detection) ─────────────────────────────────
const LoginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  authKey: z.string().regex(/^[0-9a-f]{64}$/i),
});

router.post('/login', authLimiter, validate(LoginSchema), async (req, res) => {
  const { email, authKey } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    // Constant-time decoy hash comparison
    await verifyAuthKey('00'.repeat(32), '00'.repeat(16), '00'.repeat(32));
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  }

  // Check progressive lockout
  if (user.lockout.lockedUntil && user.lockout.lockedUntil > new Date()) {
    const retryAfter = Math.ceil((user.lockout.lockedUntil.getTime() - Date.now()) / 1000);
    return res.status(429).json({
      error: {
        code: 'LOCKED_OUT',
        message: 'Account temporarily locked due to too many failed attempts.',
        retryAfter,
      },
    });
  }

  const valid = await verifyAuthKey(authKey, user.authHash.salt, user.authHash.hash);

  if (!valid) {
    user.lockout.attempts = (user.lockout.attempts || 0) + 1;
    let lockedSeconds = 0;
    if (user.lockout.attempts >= 15) lockedSeconds = 3600; // 1 hour
    else if (user.lockout.attempts >= 10) lockedSeconds = 900; // 15 mins
    else if (user.lockout.attempts >= 5) lockedSeconds = 60; // 1 min

    if (lockedSeconds > 0) {
      user.lockout.lockedUntil = new Date(Date.now() + lockedSeconds * 1000);
      await logAudit({
        userId: user._id,
        event: 'auth.lockout',
        req,
        meta: { attempts: user.lockout.attempts, lockedSeconds },
      });
    }

    await user.save();
    await logAudit({ userId: user._id, event: 'auth.login_failed', req });
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  }

  // Successful authKey verify: reset lockout
  user.lockout.attempts = 0;
  user.lockout.lockedUntil = null;
  await user.save();

  // Check if MFA is required
  const hasTotp = user.mfa?.totp?.enabled;
  const hasEmailOtp = user.mfa?.emailOtp?.enabled;
  const hasPasskeys = user.mfa?.passkeys?.length > 0;

  if (hasTotp || hasEmailOtp || hasPasskeys) {
    // Issue single-use mfaToken (handled in Phase 3)
    const mfaToken = issueAccessToken({ id: user._id.toString(), email: user.email, role: 'mfa_pending' });
    const methods = [];
    if (hasTotp) methods.push('totp');
    if (hasEmailOtp) methods.push('email_otp');
    if (hasPasskeys) methods.push('passkey');
    if (user.mfa?.backupCodes?.some((b) => !b.used)) methods.push('backup_code');

    return res.json({ mfaRequired: true, mfaToken, methods });
  }

  // No MFA: issue session
  const { raw, hash, expiresAt } = generateRefreshToken();
  const familyId = randomHex(16);
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket?.remoteAddress || '';

  await Session.create({
    userId: user._id,
    tokenHash: hash,
    familyId,
    device: {
      ua,
      ipPrefix: getCoarseIp(ip),
      label: getDeviceLabel(ua, ip),
    },
    expiresAt,
  });

  res.cookie('refresh_token', raw, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  const accessToken = issueAccessToken({
    id: user._id.toString(),
    email: user.email,
    role: user.role,
  });

  await logAudit({ userId: user._id, event: 'auth.login', req });

  res.json({
    accessToken,
    wrappedVaultKey: user.wrappedVaultKey,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      settings: user.settings,
    },
  });
});

// ── Refresh Token Rotation with Reuse Detection (AUTH-05) ───────────────────
router.post('/refresh', async (req, res) => {
  const rawToken = req.cookies.refresh_token;
  if (!rawToken) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No refresh token provided' } });
  }

  const hash = hashRefreshToken(rawToken);
  const session = await Session.findOne({ tokenHash: hash });

  if (!session) {
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid session' } });
  }

  // Reuse detection: token already revoked!
  if (session.revokedAt) {
    // Invalidate entire family immediately
    await Session.updateMany({ familyId: session.familyId }, { revokedAt: new Date() });
    await logAudit({
      userId: session.userId,
      event: 'auth.refresh_reuse',
      req,
      meta: { familyId: session.familyId },
    });
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    return res.status(401).json({
      error: { code: 'TOKEN_REUSED', message: 'Session invalidated due to reuse detection' },
    });
  }

  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') {
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User account is not active' } });
  }

  // Rotate token: revoke current session
  session.revokedAt = new Date();
  session.lastUsedAt = new Date();
  await session.save();

  // Create new session in same family
  const { raw: newRaw, hash: newHash, expiresAt } = generateRefreshToken();
  await Session.create({
    userId: user._id,
    tokenHash: newHash,
    familyId: session.familyId,
    device: session.device,
    expiresAt,
  });

  res.cookie('refresh_token', newRaw, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  const accessToken = issueAccessToken({
    id: user._id.toString(),
    email: user.email,
    role: user.role,
  });

  res.json({
    accessToken,
    wrappedVaultKey: user.wrappedVaultKey,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      settings: user.settings,
    },
  });
});

// ── Logout (AUTH-06) ─────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const rawToken = req.cookies.refresh_token;
  if (rawToken) {
    const hash = hashRefreshToken(rawToken);
    await Session.updateOne({ tokenHash: hash }, { revokedAt: new Date() });
  }
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  res.json({ status: 'ok', message: 'Logged out successfully' });
});

// ── Logout All (AUTH-06) ─────────────────────────────────────────────────────
router.post('/logout-all', requireAuth, async (req, res) => {
  await Session.updateMany({ userId: req.user.id, revokedAt: null }, { revokedAt: new Date() });
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  await logAudit({ userId: req.user.id, event: 'auth.logout_all', req });
  res.json({ status: 'ok', message: 'All sessions revoked' });
});

export default router;
