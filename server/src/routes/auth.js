// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { createHmac, randomBytes } from 'node:crypto';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { Challenge } from '../models/Challenge.js';
import {
  hashAuthKey,
  verifyAuthKey,
  hashRecoveryVerifier,
  hashToken,
  decryptServerData,
  safeEqual,
  randomHex,
} from '../../lib/crypto.js';
import {
  issueAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  issueMfaToken,
  verifyMfaToken,
  issueStepUpToken,
  issueRecoveryToken,
  verifyRecoveryToken,
} from '../../lib/tokens.js';
import { verifyTotp } from '../../lib/totp.js';
import { getAuthenticationOptions, verifyAuthentication } from '../../lib/webauthn.js';
import { logAudit, getCoarseIp, getDeviceLabel } from '../../lib/audit.js';
import { sendMail } from '../../lib/mail.js';
import { config } from '../config.js';
import { authLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Common session and token issuance helper for password and MFA logins.
 * @param {import('../models/User.js').User} user
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function issueSessionAndResponse(user, req, res) {
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

  return {
    accessToken,
    wrappedVaultKey: user.wrappedVaultKey,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      settings: user.settings,
    },
  };
}

/**
 * Extract MFA token from Authorization header or body.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractMfaToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return req.body?.mfaToken || null;
}


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
    const mfaToken = issueMfaToken({ id: user._id.toString(), email: user.email });
    const methods = [];
    if (hasTotp) methods.push('totp');
    if (hasEmailOtp) methods.push('email_otp');
    if (hasPasskeys) methods.push('passkey');
    if (user.mfa?.backupCodes?.some((b) => !b.used)) methods.push('backup_code');

    return res.json({ mfaRequired: true, mfaToken, methods });
  }

  // No MFA: issue session
  const result = await issueSessionAndResponse(user, req, res);
  await logAudit({ userId: user._id, event: 'auth.login', req });
  res.json(result);
});

// ── MFA: Send Email OTP (MFA-03) ─────────────────────────────────────────────
router.post('/mfa/email/send', authLimiter, async (req, res) => {
  const token = extractMfaToken(req);
  if (!token) {
    return res.status(401).json({ error: { code: 'MFA_TOKEN_REQUIRED', message: 'MFA token required' } });
  }

  let payload;
  try {
    payload = verifyMfaToken(token);
  } catch {
    return res.status(401).json({ error: { code: 'MFA_TOKEN_INVALID', message: 'Valid MFA token required' } });
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User not found or inactive' } });
  }

  // 60-second cooldown
  const recent = await Challenge.findOne({
    userId: user._id,
    purpose: 'email_otp',
    createdAt: { $gt: new Date(Date.now() - 60 * 1000) },
  });
  if (recent) {
    return res.status(429).json({
      error: { code: 'COOLDOWN_ACTIVE', message: 'Please wait before requesting another code' },
    });
  }

  const codeNum = (randomBytes(4).readUInt32BE(0) % 900000) + 100000;
  const code = String(codeNum);
  const codeHash = hashToken(code);

  await Challenge.create({
    userId: user._id,
    purpose: 'email_otp',
    codeHash,
    attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  });

  await sendMail({
    to: user.email,
    subject: 'Your VaultGuard security code',
    text: `Your one-time security code is: ${code}\nIt expires in 10 minutes.`,
  });

  res.json({ status: 'ok', message: 'Security code sent to your email' });
});

// ── MFA: Passkey Authentication Options (MFA-04) ─────────────────────────────
router.post('/mfa/passkey/options', authLimiter, async (req, res) => {
  const token = extractMfaToken(req);
  if (!token) {
    return res.status(401).json({ error: { code: 'MFA_TOKEN_REQUIRED', message: 'MFA token required' } });
  }

  let payload;
  try {
    payload = verifyMfaToken(token);
  } catch {
    return res.status(401).json({ error: { code: 'MFA_TOKEN_INVALID', message: 'Valid MFA token required' } });
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.mfa?.passkeys?.length) {
    return res.status(400).json({ error: { code: 'NO_PASSKEYS', message: 'No registered passkeys found' } });
  }

  const options = await getAuthenticationOptions(user.mfa.passkeys);

  await Challenge.create({
    userId: user._id,
    purpose: 'passkey_auth',
    codeHash: options.challenge,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.json(options);
});

// ── MFA: Verify Second Factor & Login (MFA-05) ────────────────────────────────
const MfaVerifySchema = z.object({
  mfaToken: z.string().optional(),
  method: z.enum(['totp', 'backup_code', 'email_otp', 'passkey']),
  code: z.string().trim().optional(),
  response: z.any().optional(),
});

router.post('/mfa/verify', authLimiter, validate(MfaVerifySchema), async (req, res) => {
  const token = extractMfaToken(req);
  if (!token) {
    return res.status(401).json({ error: { code: 'MFA_TOKEN_REQUIRED', message: 'MFA token required' } });
  }

  let payload;
  try {
    payload = verifyMfaToken(token);
  } catch {
    return res.status(401).json({ error: { code: 'MFA_TOKEN_INVALID', message: 'Valid MFA token required' } });
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User not found or inactive' } });
  }

  const { method, code, response } = req.body;

  if (method === 'totp') {
    if (!user.mfa?.totp?.enabled || !user.mfa?.totp?.secret) {
      return res.status(400).json({ error: { code: 'TOTP_NOT_ENABLED', message: 'TOTP is not enabled' } });
    }
    if (!code) {
      return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Verification code is required' } });
    }
    const secret = decryptServerData(JSON.parse(user.mfa.totp.secret));
    const { valid, step } = verifyTotp(secret, code);
    if (!valid) {
      await logAudit({ userId: user._id, event: 'auth.mfa_failed', req, meta: { method: 'totp' } });
      return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } });
    }
    if (user.mfa.totp.lastStep !== undefined && step <= user.mfa.totp.lastStep) {
      return res.status(401).json({ error: { code: 'CODE_ALREADY_USED', message: 'Code has already been used' } });
    }
    user.mfa.totp.lastStep = step;
    await user.save();
  } else if (method === 'backup_code') {
    if (!code) {
      return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Backup code is required' } });
    }
    const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const targetHash = hashToken(clean);
    const backup = user.mfa?.backupCodes?.find((b) => !b.used && safeEqual(b.codeHash, targetHash));
    if (!backup) {
      await logAudit({ userId: user._id, event: 'auth.mfa_failed', req, meta: { method: 'backup_code' } });
      return res.status(401).json({ error: { code: 'INVALID_BACKUP_CODE', message: 'Invalid or used backup code' } });
    }
    backup.used = true;
    backup.usedAt = new Date();
    user.markModified('mfa.backupCodes');
    await user.save();
  } else if (method === 'email_otp') {
    if (!code) {
      return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Verification code is required' } });
    }
    const challenge = await Challenge.findOne({
      userId: user._id,
      purpose: 'email_otp',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!challenge) {
      return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid or expired verification code' } });
    }
    if (challenge.attempts >= 5) {
      return res.status(401).json({ error: { code: 'MAX_ATTEMPTS_EXCEEDED', message: 'Maximum verification attempts exceeded' } });
    }

    const codeHash = hashToken(code.trim());
    if (!safeEqual(challenge.codeHash, codeHash)) {
      challenge.attempts = (challenge.attempts || 0) + 1;
      await challenge.save();
      await logAudit({ userId: user._id, event: 'auth.mfa_failed', req, meta: { method: 'email_otp' } });
      return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } });
    }

    challenge.usedAt = new Date();
    await challenge.save();
  } else if (method === 'passkey') {
    if (!response || !response.id) {
      return res.status(400).json({ error: { code: 'PASSKEY_RESPONSE_REQUIRED', message: 'Passkey response is required' } });
    }
    const challenge = await Challenge.findOne({
      userId: user._id,
      purpose: 'passkey_auth',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!challenge) {
      return res.status(401).json({ error: { code: 'CHALLENGE_EXPIRED', message: 'Passkey challenge expired' } });
    }

    const passkey = user.mfa?.passkeys?.find((p) => p.id === response.id);
    if (!passkey) {
      return res.status(401).json({ error: { code: 'PASSKEY_NOT_FOUND', message: 'Unrecognized passkey' } });
    }

    let verification;
    try {
      verification = await verifyAuthentication(response, challenge.codeHash, passkey);
    } catch {
      await logAudit({ userId: user._id, event: 'auth.mfa_failed', req, meta: { method: 'passkey' } });
      return res.status(401).json({ error: { code: 'PASSKEY_VERIFICATION_FAILED', message: 'Passkey verification failed' } });
    }

    if (!verification.verified) {
      await logAudit({ userId: user._id, event: 'auth.mfa_failed', req, meta: { method: 'passkey' } });
      return res.status(401).json({ error: { code: 'PASSKEY_VERIFICATION_FAILED', message: 'Passkey verification failed' } });
    }

    passkey.counter = verification.authenticationInfo.newCounter;
    challenge.usedAt = new Date();
    await challenge.save();
    await user.save();
  }

  const result = await issueSessionAndResponse(user, req, res);
  await logAudit({ userId: user._id, event: 'auth.mfa_success', req, meta: { method } });
  res.json(result);
});

// ── Step-Up Authentication (AUTH-16) ─────────────────────────────────────────
const StepUpSchema = z.object({
  authKey: z.string().regex(/^[0-9a-f]{64}$/i),
  method: z.enum(['totp', 'backup_code', 'email_otp', 'passkey']).optional(),
  code: z.string().trim().optional(),
  response: z.any().optional(),
});

router.post('/step-up', requireAuth, authLimiter, validate(StepUpSchema), async (req, res) => {
  const { authKey, method, code, response } = req.body;
  const user = await User.findById(req.user.id);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User not found or inactive' } });
  }

  const valid = await verifyAuthKey(authKey, user.authHash.salt, user.authHash.hash);
  if (!valid) {
    await logAudit({ userId: user._id, event: 'auth.step_up_failed', req });
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  }

  const hasTotp = user.mfa?.totp?.enabled;
  const hasEmailOtp = user.mfa?.emailOtp?.enabled;
  const hasPasskeys = user.mfa?.passkeys?.length > 0;
  const mfaEnabled = hasTotp || hasEmailOtp || hasPasskeys;

  if (mfaEnabled) {
    if (!method) {
      const methods = [];
      if (hasTotp) methods.push('totp');
      if (hasEmailOtp) methods.push('email_otp');
      if (hasPasskeys) methods.push('passkey');
      if (user.mfa?.backupCodes?.some((b) => !b.used)) methods.push('backup_code');
      return res.status(400).json({
        error: { code: 'MFA_REQUIRED', message: 'Second factor required for step-up' },
        methods,
      });
    }

    if (method === 'totp') {
      if (!user.mfa?.totp?.enabled || !user.mfa?.totp?.secret) {
        return res.status(400).json({ error: { code: 'TOTP_NOT_ENABLED', message: 'TOTP is not enabled' } });
      }
      if (!code) {
        return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Verification code is required' } });
      }
      const secret = decryptServerData(JSON.parse(user.mfa.totp.secret));
      const { valid: totpValid, step } = verifyTotp(secret, code);
      if (!totpValid) {
        return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } });
      }
      if (user.mfa.totp.lastStep !== undefined && step <= user.mfa.totp.lastStep) {
        return res.status(401).json({ error: { code: 'CODE_ALREADY_USED', message: 'Code has already been used' } });
      }
      user.mfa.totp.lastStep = step;
      await user.save();
    } else if (method === 'backup_code') {
      if (!code) {
        return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Backup code is required' } });
      }
      const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
      const targetHash = hashToken(clean);
      const backup = user.mfa?.backupCodes?.find((b) => !b.used && safeEqual(b.codeHash, targetHash));
      if (!backup) {
        return res.status(401).json({ error: { code: 'INVALID_BACKUP_CODE', message: 'Invalid or used backup code' } });
      }
      backup.used = true;
      backup.usedAt = new Date();
      user.markModified('mfa.backupCodes');
      await user.save();
    } else if (method === 'email_otp') {
      if (!code) {
        return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Verification code is required' } });
      }
      const challenge = await Challenge.findOne({
        userId: user._id,
        purpose: 'email_otp',
        usedAt: null,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (!challenge) {
        return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid or expired verification code' } });
      }
      const codeHash = hashToken(code.trim());
      if (!safeEqual(challenge.codeHash, codeHash)) {
        challenge.attempts = (challenge.attempts || 0) + 1;
        await challenge.save();
        return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } });
      }
      challenge.usedAt = new Date();
      await challenge.save();
    } else if (method === 'passkey') {
      if (!response || !response.id) {
        return res.status(400).json({ error: { code: 'PASSKEY_RESPONSE_REQUIRED', message: 'Passkey response is required' } });
      }
      const challenge = await Challenge.findOne({
        userId: user._id,
        purpose: 'passkey_auth',
        usedAt: null,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (!challenge) {
        return res.status(401).json({ error: { code: 'CHALLENGE_EXPIRED', message: 'Passkey challenge expired' } });
      }
      const passkey = user.mfa?.passkeys?.find((p) => p.id === response.id);
      if (!passkey) {
        return res.status(401).json({ error: { code: 'PASSKEY_NOT_FOUND', message: 'Unrecognized passkey' } });
      }
      const verification = await verifyAuthentication(response, challenge.codeHash, passkey);
      if (!verification.verified) {
        return res.status(401).json({ error: { code: 'PASSKEY_VERIFICATION_FAILED', message: 'Passkey verification failed' } });
      }
      passkey.counter = verification.authenticationInfo.newCounter;
      challenge.usedAt = new Date();
      await challenge.save();
      await user.save();
    }
  }

  const stepUpToken = issueStepUpToken({ id: user._id.toString(), email: user.email });
  await logAudit({ userId: user._id, event: 'auth.step_up', req });
  res.json({ status: 'ok', stepUpToken });
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

// ── Account Recovery: Start (REC-02) ─────────────────────────────────────────
const RecoveryStartSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

router.post('/recovery/start', authLimiter, validate(RecoveryStartSchema), async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Generic 202 whether user exists or not (no enumeration per REC-02)
  if (!user || user.status !== 'active') {
    return res.status(202).json({
      message: 'If an account exists, recovery instructions have been sent.',
    });
  }

  const token = randomHex(32);
  const codeHash = hashToken(token);

  await Challenge.create({
    userId: user._id,
    purpose: 'recovery',
    codeHash,
    attempts: 0,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min TTL
  });

  const recoveryUrl = `${config.CLIENT_ORIGIN}/recover?token=${token}&email=${encodeURIComponent(user.email)}`;

  await sendMail({
    to: user.email,
    subject: 'VaultGuard Account Recovery Link',
    text: `You requested account recovery for your VaultGuard account.\nClick the link below to proceed:\n${recoveryUrl}\nThis link expires in 15 minutes. If you did not request this, ignore this email.`,
  });

  await logAudit({ userId: user._id, event: 'recovery.start', req });

  res.status(202).json({
    message: 'If an account exists, recovery instructions have been sent.',
  });
});

// ── Account Recovery: Verify (REC-03) ────────────────────────────────────────
const RecoveryVerifySchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  token: z.string().regex(/^[0-9a-f]{64}$/i),
  method: z.enum(['totp', 'backup_code', 'email_otp', 'passkey']).optional(),
  code: z.string().trim().optional(),
  response: z.any().optional(),
});

router.post('/recovery/verify', authLimiter, validate(RecoveryVerifySchema), async (req, res) => {
  const { email, token, method, code, response } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired recovery link' } });
  }

  const challenge = await Challenge.findOne({
    userId: user._id,
    purpose: 'recovery',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!challenge) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired recovery link' } });
  }

  if (challenge.attempts >= 5) {
    challenge.usedAt = new Date();
    await challenge.save();
    return res.status(401).json({ error: { code: 'MAX_ATTEMPTS_EXCEEDED', message: 'Maximum recovery attempts exceeded' } });
  }

  const tokenHash = hashToken(token);
  if (!safeEqual(challenge.codeHash, tokenHash)) {
    challenge.attempts = (challenge.attempts || 0) + 1;
    await challenge.save();
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired recovery link' } });
  }

  // Check MFA requirement
  const hasTotp = user.mfa?.totp?.enabled;
  const hasEmailOtp = user.mfa?.emailOtp?.enabled;
  const hasPasskeys = user.mfa?.passkeys?.length > 0;
  const mfaEnabled = hasTotp || hasEmailOtp || hasPasskeys;

  if (mfaEnabled) {
    if (!method) {
      const methods = [];
      if (hasTotp) methods.push('totp');
      if (hasEmailOtp) methods.push('email_otp');
      if (hasPasskeys) methods.push('passkey');
      if (user.mfa?.backupCodes?.some((b) => !b.used)) methods.push('backup_code');
      return res.json({ mfaRequired: true, methods });
    }

    // Verify MFA
    if (method === 'totp') {
      if (!code) return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Verification code required' } });
      const secret = decryptServerData(JSON.parse(user.mfa.totp.secret));
      const { valid, step } = verifyTotp(secret, code);
      if (!valid) {
        challenge.attempts = (challenge.attempts || 0) + 1;
        await challenge.save();
        return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } });
      }
      user.mfa.totp.lastStep = step;
      await user.save();
    } else if (method === 'backup_code') {
      if (!code) return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Backup code required' } });
      const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
      const targetHash = hashToken(clean);
      const backup = user.mfa?.backupCodes?.find((b) => !b.used && safeEqual(b.codeHash, targetHash));
      if (!backup) {
        challenge.attempts = (challenge.attempts || 0) + 1;
        await challenge.save();
        return res.status(401).json({ error: { code: 'INVALID_BACKUP_CODE', message: 'Invalid backup code' } });
      }
      backup.used = true;
      backup.usedAt = new Date();
      user.markModified('mfa.backupCodes');
      await user.save();
    } else if (method === 'email_otp') {
      if (!code) return res.status(400).json({ error: { code: 'CODE_REQUIRED', message: 'Verification code required' } });
      const otpChallenge = await Challenge.findOne({
        userId: user._id,
        purpose: 'email_otp',
        usedAt: null,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (!otpChallenge || !safeEqual(otpChallenge.codeHash, hashToken(code.trim()))) {
        challenge.attempts = (challenge.attempts || 0) + 1;
        await challenge.save();
        return res.status(401).json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } });
      }
      otpChallenge.usedAt = new Date();
      await otpChallenge.save();
    } else if (method === 'passkey') {
      if (!response || !response.id) return res.status(400).json({ error: { code: 'PASSKEY_RESPONSE_REQUIRED', message: 'Passkey response required' } });
      const passkey = user.mfa?.passkeys?.find((p) => p.id === response.id);
      if (!passkey) return res.status(401).json({ error: { code: 'PASSKEY_NOT_FOUND', message: 'Unrecognized passkey' } });
      const pkChallenge = await Challenge.findOne({
        userId: user._id,
        purpose: 'passkey_auth',
        usedAt: null,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });
      if (!pkChallenge) return res.status(401).json({ error: { code: 'CHALLENGE_EXPIRED', message: 'Passkey challenge expired' } });
      const verification = await verifyAuthentication(response, pkChallenge.codeHash, passkey);
      if (!verification.verified) {
        challenge.attempts = (challenge.attempts || 0) + 1;
        await challenge.save();
        return res.status(401).json({ error: { code: 'PASSKEY_VERIFICATION_FAILED', message: 'Passkey verification failed' } });
      }
      passkey.counter = verification.authenticationInfo.newCounter;
      pkChallenge.usedAt = new Date();
      await pkChallenge.save();
      await user.save();
    }
  }

  challenge.usedAt = new Date();
  await challenge.save();

  const recoveryToken = issueRecoveryToken({ id: user._id.toString(), email: user.email });

  res.json({
    recoveryToken,
    recoveryWrappedVaultKey: user.recoveryWrappedVaultKey,
    kdf: user.kdf,
  });
});

// ── Account Recovery: Complete (REC-04, REC-06) ──────────────────────────────
const RecoveryCompleteSchema = z.object({
  recoveryToken: z.string(),
  recoveryVerifier: z.string().regex(/^[0-9a-f]{64}$/i),
  newAuthKey: z.string().regex(/^[0-9a-f]{64}$/i),
  newKdf: z.object({
    algo: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().min(600000),
    salt: z.string().regex(/^[0-9a-f]{32}$/i),
  }),
  newWrappedVaultKey: z.object({
    iv: z.string().regex(/^[0-9a-f]{24}$/i),
    ct: z.string().regex(/^[0-9a-f]+$/i),
  }),
  newRecoveryWrappedVaultKey: z.object({
    iv: z.string().regex(/^[0-9a-f]{24}$/i),
    ct: z.string().regex(/^[0-9a-f]+$/i),
  }),
  newRecoveryVerifier: z.string().regex(/^[0-9a-f]{64}$/i),
});

router.post('/recovery/complete', authLimiter, validate(RecoveryCompleteSchema), async (req, res) => {
  const {
    recoveryToken,
    recoveryVerifier,
    newAuthKey,
    newKdf,
    newWrappedVaultKey,
    newRecoveryWrappedVaultKey,
    newRecoveryVerifier,
  } = req.body;

  let payload;
  try {
    payload = verifyRecoveryToken(recoveryToken);
  } catch {
    return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired recovery session' } });
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User not found or inactive' } });
  }

  const verifierHash = hashRecoveryVerifier(recoveryVerifier);
  if (!safeEqual(user.recoveryVerifierHash, verifierHash)) {
    await logAudit({ userId: user._id, event: 'recovery.failed', req, meta: { reason: 'verifier_mismatch' } });
    return res.status(401).json({ error: { code: 'INVALID_RECOVERY_KEY', message: 'Invalid recovery key' } });
  }

  // Update key material
  user.authHash = await hashAuthKey(newAuthKey);
  user.kdf = newKdf;
  user.wrappedVaultKey = newWrappedVaultKey;
  user.recoveryWrappedVaultKey = newRecoveryWrappedVaultKey;
  user.recoveryVerifierHash = hashRecoveryVerifier(newRecoveryVerifier);
  user.recoveryKeyConfirmed = true;

  // Revoke all existing sessions
  await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await user.save();

  // Send security alert email
  sendMail({
    to: user.email,
    subject: 'Security Alert: Master password reset via recovery key',
    text: 'Your VaultGuard account master password was reset using your recovery key. All previous sessions have been revoked. If you did not perform this recovery, contact support immediately.',
  }).catch(() => {});

  await logAudit({ userId: user._id, event: 'recovery.complete', req });

  res.json({
    status: 'ok',
    message: 'Account recovery completed successfully. Please log in with your new master password.',
  });
});

// ── Account Recovery: Reset Account (REC-05: Lost Key Fallback) ──────────────
const ResetAccountSchema = z.object({
  recoveryToken: z.string(),
  confirmation: z.literal('DELETE MY VAULT'),
  newAuthKey: z.string().regex(/^[0-9a-f]{64}$/i),
  newKdf: z.object({
    algo: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().min(600000),
    salt: z.string().regex(/^[0-9a-f]{32}$/i),
  }),
  newWrappedVaultKey: z.object({
    iv: z.string().regex(/^[0-9a-f]{24}$/i),
    ct: z.string().regex(/^[0-9a-f]+$/i),
  }),
  newRecoveryWrappedVaultKey: z.object({
    iv: z.string().regex(/^[0-9a-f]{24}$/i),
    ct: z.string().regex(/^[0-9a-f]+$/i),
  }),
  newRecoveryVerifier: z.string().regex(/^[0-9a-f]{64}$/i),
});

router.post('/recovery/reset-account', authLimiter, validate(ResetAccountSchema), async (req, res) => {
  const {
    recoveryToken,
    newAuthKey,
    newKdf,
    newWrappedVaultKey,
    newRecoveryWrappedVaultKey,
    newRecoveryVerifier,
  } = req.body;

  let payload;
  try {
    payload = verifyRecoveryToken(recoveryToken);
  } catch {
    return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired recovery session' } });
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User not found or inactive' } });
  }

  // Wipes all user vault data if models exist
  try {
    const { Item } = await import('../models/Item.js').catch(() => ({ Item: null }));
    const { Folder } = await import('../models/Folder.js').catch(() => ({ Folder: null }));
    if (Item) await Item.deleteMany({ userId: user._id });
    if (Folder) await Folder.deleteMany({ userId: user._id });
  } catch {}

  user.authHash = await hashAuthKey(newAuthKey);
  user.kdf = newKdf;
  user.wrappedVaultKey = newWrappedVaultKey;
  user.recoveryWrappedVaultKey = newRecoveryWrappedVaultKey;
  user.recoveryVerifierHash = hashRecoveryVerifier(newRecoveryVerifier);
  user.recoveryKeyConfirmed = true;

  // Revoke all existing sessions
  await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await user.save();

  sendMail({
    to: user.email,
    subject: 'Security Alert: VaultGuard account reset and vault wiped',
    text: 'Your VaultGuard account was reset and all vault credentials were permanently deleted following a lost recovery key request.',
  }).catch(() => {});

  await logAudit({ userId: user._id, event: 'recovery.reset', req });

  res.json({
    status: 'ok',
    message: 'Vault wiped and account reset successfully. You can now log in with your new master password.',
  });
});

export default router;

