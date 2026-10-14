// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStepUp } from '../middleware/stepUp.js';
import { validate } from '../middleware/validate.js';
import { hashRecoveryVerifier } from '../../lib/crypto.js';
import { logAudit } from '../../lib/audit.js';
import { sendMail } from '../../lib/mail.js';

const router = Router();

// ── GET /me ──────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id).select(
    '_id email role emailVerified settings mfa.totp.enabled mfa.emailOtp.enabled mfa.passkeys createdAt'
  );

  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  res.json({
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      settings: user.settings,
      mfaEnabled: Boolean(
        user.mfa?.totp?.enabled ||
        user.mfa?.emailOtp?.enabled ||
        (user.mfa?.passkeys && user.mfa.passkeys.length > 0)
      ),
      mfa: {
        totpEnabled: Boolean(user.mfa?.totp?.enabled),
        emailOtpEnabled: Boolean(user.mfa?.emailOtp?.enabled),
        passkeysCount: user.mfa?.passkeys?.length || 0,
        hasBackupCodes: Boolean(user.mfa?.backupCodes?.some((b) => !b.used)),
      },
      createdAt: user.createdAt,
    },
  });
});

// ── PATCH /me/settings ───────────────────────────────────────────────────────
const SettingsSchema = z.object({
  autoLockMinutes: z.number().int().min(1).max(60).optional(),
});

router.patch('/settings', requireAuth, validate(SettingsSchema), async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  if (req.body.autoLockMinutes !== undefined) {
    user.settings.autoLockMinutes = req.body.autoLockMinutes;
  }

  await user.save();
  res.json({ status: 'ok', settings: user.settings });
});

// ── Rotate Recovery Key (REC-07: requires Step-Up) ───────────────────────────
const RotateRecoveryKeySchema = z.object({
  recoveryWrappedVaultKey: z.object({
    iv: z.string().regex(/^[0-9a-f]{24}$/i),
    ct: z.string().regex(/^[0-9a-f]+$/i),
  }),
  recoveryVerifier: z.string().regex(/^[0-9a-f]{64}$/i),
});

router.post(
  '/recovery-key/rotate',
  requireAuth,
  requireStepUp,
  validate(RotateRecoveryKeySchema),
  async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    user.recoveryWrappedVaultKey = req.body.recoveryWrappedVaultKey;
    user.recoveryVerifierHash = hashRecoveryVerifier(req.body.recoveryVerifier);
    await user.save();

    await logAudit({ userId: user._id, event: 'recovery.rotate', req });

    sendMail({
      to: user.email,
      subject: 'Security Alert: Recovery key rotated',
      text: 'A new recovery key was generated and registered for your VaultGuard account. The previous recovery key is no longer valid.',
    }).catch(() => {});

    res.json({ status: 'ok', message: 'Recovery key rotated successfully' });
  }
);

export default router;

