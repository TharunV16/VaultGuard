// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

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

export default router;
