// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { User } from '../models/User.js';
import { Challenge } from '../models/Challenge.js';
import {
  encryptServerData,
  decryptServerData,
  hashToken,
} from '../../lib/crypto.js';
import {
  generateTotpSecret,
  verifyTotp,
  totpUri,
} from '../../lib/totp.js';
import {
  getRegistrationOptions,
  verifyRegistration,
} from '../../lib/webauthn.js';
import { logAudit } from '../../lib/audit.js';
import { sendMail } from '../../lib/mail.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStepUp } from '../middleware/stepUp.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Crockford Base32 alphabet: 32 chars without ambiguous I, L, O, U
const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a single 10-character Crockford Base32 backup code formatted as XXXXX-XXXXX.
 * Uses CSPRNG with exact 5-bit masking (no modulo bias).
 * @returns {string}
 */
export function generateBackupCode() {
  const bytes = randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += CROCKFORD_CHARS[bytes[i] & 0x1f];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

// ── TOTP Setup (MFA-01) ──────────────────────────────────────────────────────
router.post('/totp/setup', requireAuth, authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User not found or inactive' } });
  }

  const secretBase32 = generateTotpSecret();
  const secretEnc = JSON.stringify(encryptServerData(secretBase32));

  user.mfa.totp = {
    enabled: false,
    secret: secretEnc,
    lastStep: undefined,
  };
  await user.save();

  const uri = totpUri(user.email, secretBase32, 'VaultGuard');
  res.json({ secret: secretBase32, uri });
});

// ── TOTP Enable (MFA-01) ─────────────────────────────────────────────────────
const TotpEnableSchema = z.object({
  code: z.string().trim().length(6),
});

router.post('/totp/enable', requireAuth, authLimiter, validate(TotpEnableSchema), async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: { code: 'USER_INACTIVE', message: 'User not found or inactive' } });
  }

  if (!user.mfa?.totp?.secret) {
    return res.status(400).json({ error: { code: 'TOTP_NOT_INITIALIZED', message: 'Call setup before enabling TOTP' } });
  }

  const secret = decryptServerData(JSON.parse(user.mfa.totp.secret));
  const { valid, step } = verifyTotp(secret, req.body.code);

  if (!valid) {
    return res.status(400).json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } });
  }

  user.mfa.totp.enabled = true;
  user.mfa.totp.lastStep = step;

  // Generate 10 backup codes if user doesn't have any yet
  let plainBackupCodes = null;
  if (!user.mfa.backupCodes || user.mfa.backupCodes.length === 0) {
    plainBackupCodes = [];
    const stored = [];
    for (let i = 0; i < 10; i++) {
      const code = generateBackupCode();
      plainBackupCodes.push(code);
      const clean = code.replace(/[^0-9A-Z]/gi, '').toUpperCase();
      stored.push({ codeHash: hashToken(clean), used: false });
    }
    user.mfa.backupCodes = stored;
  }

  await user.save();
  await logAudit({ userId: user._id, event: 'mfa.totp_enabled', req });

  res.json({
    status: 'ok',
    message: 'TOTP enabled successfully',
    backupCodes: plainBackupCodes,
  });
});

// ── TOTP Disable (MFA-06: requires Step-Up) ──────────────────────────────────
router.delete('/totp', requireAuth, requireStepUp, authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  user.mfa.totp.enabled = false;
  user.mfa.totp.secret = undefined;
  await user.save();

  await logAudit({ userId: user._id, event: 'mfa.totp_disabled', req });

  sendMail({
    to: user.email,
    subject: 'Security Alert: Authenticator app (TOTP) removed',
    text: 'Authenticator app (TOTP) was removed from your VaultGuard account. If you did not do this, change your password immediately.',
  }).catch(() => {});

  res.json({ status: 'ok', message: 'TOTP disabled successfully' });
});

// ── Backup Codes Regenerate (MFA-02: requires Step-Up) ────────────────────────
router.post('/backup-codes/regenerate', requireAuth, requireStepUp, authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  const plainCodes = [];
  const storedCodes = [];
  for (let i = 0; i < 10; i++) {
    const code = generateBackupCode();
    plainCodes.push(code);
    const clean = code.replace(/[^0-9A-Z]/gi, '').toUpperCase();
    storedCodes.push({ codeHash: hashToken(clean), used: false });
  }

  user.mfa.backupCodes = storedCodes;
  await user.save();

  await logAudit({ userId: user._id, event: 'mfa.backup_codes_regenerated', req });

  sendMail({
    to: user.email,
    subject: 'Security Alert: New MFA backup codes generated',
    text: 'A new set of emergency MFA backup codes was generated for your VaultGuard account. Any previously generated backup codes have been invalidated.',
  }).catch(() => {});

  res.json({ backupCodes: plainCodes });
});

// ── Email OTP Enable (MFA-03) ────────────────────────────────────────────────
router.post('/email/enable', requireAuth, authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  if (!user.emailVerified) {
    return res.status(400).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address first' } });
  }

  user.mfa.emailOtp.enabled = true;
  await user.save();

  await logAudit({ userId: user._id, event: 'mfa.email_enabled', req });

  res.json({ status: 'ok', message: 'Email OTP enabled successfully' });
});

// ── Email OTP Disable (MFA-03: requires Step-Up) ─────────────────────────────
router.post('/email/disable', requireAuth, requireStepUp, authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  user.mfa.emailOtp.enabled = false;
  await user.save();

  await logAudit({ userId: user._id, event: 'mfa.email_disabled', req });

  sendMail({
    to: user.email,
    subject: 'Security Alert: Email verification code MFA removed',
    text: 'Email OTP was disabled on your VaultGuard account.',
  }).catch(() => {});

  res.json({ status: 'ok', message: 'Email OTP disabled successfully' });
});

// ── Passkey: Register Options (MFA-04: requires Step-Up) ─────────────────────
router.post('/passkeys/register/options', requireAuth, requireStepUp, authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  const existingPasskeys = (user.mfa?.passkeys || []).map((p) => ({
    id: p.id,
    transports: p.transports,
  }));

  const options = await getRegistrationOptions(
    { id: user._id.toString(), email: user.email },
    existingPasskeys
  );

  await Challenge.create({
    userId: user._id,
    purpose: 'passkey_register',
    codeHash: options.challenge,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min TTL
  });

  res.json(options);
});

// ── Passkey: Register Verify (MFA-04: requires Step-Up) ──────────────────────
const PasskeyRegisterSchema = z.object({
  response: z.any(),
  name: z.string().trim().max(50).optional(),
});

router.post(
  '/passkeys/register/verify',
  requireAuth,
  requireStepUp,
  authLimiter,
  validate(PasskeyRegisterSchema),
  async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const challenge = await Challenge.findOne({
      userId: user._id,
      purpose: 'passkey_register',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!challenge) {
      return res.status(401).json({ error: { code: 'CHALLENGE_EXPIRED', message: 'Passkey registration challenge expired' } });
    }

    let verification;
    try {
      verification = await verifyRegistration(req.body.response, challenge.codeHash);
    } catch {
      return res.status(400).json({ error: { code: 'VERIFICATION_FAILED', message: 'Passkey registration verification failed' } });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: { code: 'VERIFICATION_FAILED', message: 'Passkey registration verification failed' } });
    }

    const { registrationInfo } = verification;
    const newPasskey = {
      id: registrationInfo.credentialID,
      publicKey: Buffer.from(registrationInfo.credentialPublicKey).toString('base64'),
      counter: registrationInfo.counter,
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      transports: req.body.response.response?.transports || [],
      name: req.body.name || 'Passkey',
      createdAt: new Date(),
    };

    user.mfa.passkeys.push(newPasskey);
    challenge.usedAt = new Date();
    await challenge.save();
    await user.save();

    await logAudit({
      userId: user._id,
      event: 'mfa.passkey_added',
      req,
      meta: { passkeyName: newPasskey.name },
    });

    res.json({
      status: 'ok',
      message: 'Passkey added successfully',
      passkey: {
        id: newPasskey.id,
        name: newPasskey.name,
        createdAt: newPasskey.createdAt,
      },
    });
  }
);

// ── Passkeys: List (MFA-04) ──────────────────────────────────────────────────
router.get('/passkeys', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  const passkeys = (user.mfa?.passkeys || []).map((p) => ({
    id: p.id,
    name: p.name,
    deviceType: p.deviceType,
    createdAt: p.createdAt,
  }));

  res.json({ passkeys });
});

// ── Passkey: Delete (MFA-04 / MFA-06: requires Step-Up) ──────────────────────
router.delete('/passkeys/:id', requireAuth, requireStepUp, authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  const initialCount = user.mfa?.passkeys?.length || 0;
  user.mfa.passkeys = (user.mfa?.passkeys || []).filter((p) => p.id !== req.params.id);

  if (user.mfa.passkeys.length === initialCount) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Passkey not found' } });
  }

  await user.save();
  await logAudit({ userId: user._id, event: 'mfa.passkey_removed', req, meta: { passkeyId: req.params.id } });

  sendMail({
    to: user.email,
    subject: 'Security Alert: Passkey removed from account',
    text: 'A security passkey was removed from your VaultGuard account. If you did not do this, please change your master password immediately.',
  }).catch(() => {});

  res.json({ status: 'ok', message: 'Passkey removed successfully' });
});

export default router;
