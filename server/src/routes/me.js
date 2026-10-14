// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Snapshot } from '../models/Snapshot.js';
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
  clipboardSeconds: z.number().int().min(5).max(120).optional(),
  breachAutoScan: z.boolean().optional(),
  snapshotsOptIn: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

router.patch('/settings', requireAuth, validate(SettingsSchema), async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  if (req.body.autoLockMinutes !== undefined) user.settings.autoLockMinutes = req.body.autoLockMinutes;
  if (req.body.clipboardSeconds !== undefined) user.settings.clipboardSeconds = req.body.clipboardSeconds;
  if (req.body.breachAutoScan !== undefined) user.settings.breachAutoScan = req.body.breachAutoScan;
  if (req.body.snapshotsOptIn !== undefined) user.settings.snapshotsOptIn = req.body.snapshotsOptIn;
  if (req.body.theme !== undefined) user.settings.theme = req.body.theme;

  await user.save();
  res.json({ status: 'ok', settings: user.settings });
});

// ── Snapshots (SCR-03: opt-in trend) ─────────────────────────────────────────
const SnapshotSchema = z.object({
  score: z.number().int().min(0).max(100),
  counts: z.object({
    weak: z.number().int().min(0).default(0),
    reused: z.number().int().min(0).default(0),
    breached: z.number().int().min(0).default(0),
    old: z.number().int().min(0).default(0),
    similar: z.number().int().min(0).default(0),
    total: z.number().int().min(0).default(0),
  }),
});

router.get('/snapshots', requireAuth, async (req, res) => {
  const snapshots = await Snapshot.find({ userId: req.user.id })
    .sort({ at: 1 })
    .limit(90)
    .lean();

  res.json({ snapshots });
});

router.post('/snapshots', requireAuth, validate(SnapshotSchema), async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  // Check if snapshot already saved today (at most daily per SCR-03)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const existingToday = await Snapshot.findOne({
    userId: req.user.id,
    at: { $gte: todayStart },
  });

  if (existingToday) {
    existingToday.score = req.body.score;
    existingToday.counts = req.body.counts;
    await existingToday.save();
    return res.json({ status: 'ok', snapshot: existingToday, updated: true });
  }

  const snapshot = await Snapshot.create({
    userId: req.user.id,
    score: req.body.score,
    counts: req.body.counts,
  });

  res.status(201).json({ status: 'ok', snapshot });
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

