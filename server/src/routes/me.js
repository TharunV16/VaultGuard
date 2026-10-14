// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { User } from '../models/User.js';
import { Snapshot } from '../models/Snapshot.js';
import { Session } from '../models/Session.js';
import { Audit } from '../models/Audit.js';
import { Item } from '../models/Item.js';
import { Folder } from '../models/Folder.js';
import { Send } from '../models/Send.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStepUp } from '../middleware/stepUp.js';
import { validate } from '../middleware/validate.js';
import { hashRecoveryVerifier, hashAuthKey } from '../../lib/crypto.js';
import { logAudit } from '../../lib/audit.js';
import { sendMail } from '../../lib/mail.js';

const router = Router();

// ── GET /me ──────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id).select(
    '_id email role emailVerified settings mfa.totp.enabled mfa.emailOtp.enabled mfa.passkeys mfa.backupCodes createdAt'
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

// ── PATCH /me/settings (SET-01, SET-02) ──────────────────────────────────────
const SettingsSchema = z.object({
  autoLockMinutes: z.number().int().min(1).max(60).optional(),
  clipboardSeconds: z.number().int().min(5).max(120).optional(),
  breachAutoScan: z.boolean().optional(),
  snapshotsOptIn: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  generatorDefaults: z.record(z.any()).optional(),
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
  if (req.body.generatorDefaults !== undefined) user.settings.generatorDefaults = req.body.generatorDefaults;

  await user.save();
  res.json({ status: 'ok', settings: user.settings });
});

// ── Sessions Management (SES-01) ─────────────────────────────────────────────
router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await Session.find({
    userId: req.user.id,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastUsedAt: -1 })
    .lean();

  const currentCookieHash = req.cookies?.vg_refresh
    ? createHash('sha256').update(req.cookies.vg_refresh).digest('hex')
    : null;

  const result = sessions.map((s) => ({
    id: s._id,
    device: s.device,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    isCurrent: Boolean(currentCookieHash && s.tokenHash === currentCookieHash),
  }));

  res.json({ sessions: result });
});

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const session = await Session.findOne({
    _id: req.params.id,
    userId: req.user.id,
    revokedAt: null,
  });

  if (!session) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
  }

  session.revokedAt = new Date();
  await session.save();

  await logAudit({
    userId: req.user.id,
    event: 'session.revoke',
    req,
    meta: { sessionId: session._id },
  });

  res.json({ status: 'ok', message: 'Session revoked' });
});

router.delete('/sessions', requireAuth, async (req, res) => {
  // Revoke all other sessions or all sessions for this user
  const currentCookieHash = req.cookies?.vg_refresh
    ? createHash('sha256').update(req.cookies.vg_refresh).digest('hex')
    : null;

  const filter = {
    userId: req.user.id,
    revokedAt: null,
  };
  if (currentCookieHash) {
    filter.tokenHash = { $ne: currentCookieHash };
  }

  const result = await Session.updateMany(filter, { revokedAt: new Date() });

  await logAudit({
    userId: req.user.id,
    event: 'session.revoke_all',
    req,
    meta: { revokedCount: result.modifiedCount },
  });

  res.json({ status: 'ok', revokedCount: result.modifiedCount });
});

// ── Audit Log (AUD-01) ───────────────────────────────────────────────────────
const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  event: z.string().optional(),
});

router.get('/audit', requireAuth, async (req, res) => {
  const parseRes = AuditQuerySchema.safeParse(req.query);
  if (!parseRes.success) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'Invalid query parameters', details: parseRes.error.flatten() },
    });
  }

  const { page, limit, event } = parseRes.data;
  const filter = { userId: req.user.id };
  if (event && event.trim()) {
    filter.event = event.trim();
  }

  const total = await Audit.countDocuments(filter);
  const events = await Audit.find(filter)
    .sort({ at: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json({
    events: events.map((e) => ({
      id: e._id,
      event: e.event,
      ipPrefix: e.ipPrefix,
      ua: e.ua,
      meta: e.meta,
      at: e.at,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit) || 1,
  });
});

// ── Change Master Password (AUTH-15, AUD-02: requires Step-Up) ──────────────
const ChangePasswordSchema = z.object({
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
});

router.post(
  '/password',
  requireAuth,
  requireStepUp,
  validate(ChangePasswordSchema),
  async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const authHash = await hashAuthKey(req.body.authKey);
    user.kdf = req.body.kdf;
    user.authHash = authHash;
    user.wrappedVaultKey = req.body.wrappedVaultKey;
    await user.save();

    // Revoke all existing sessions
    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });

    await logAudit({ userId: user._id, event: 'password.change', req });

    sendMail({
      to: user.email,
      subject: 'Security Alert: Master password changed',
      text: 'The master password for your VaultGuard account was changed. All active sessions have been revoked. If you did not make this change, please recover your account immediately.',
    }).catch(() => {});

    res.json({ status: 'ok', message: 'Master password changed successfully' });
  }
);

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

// ── Delete Account (AUTH-18: requires Step-Up and typed confirmation) ────────
const DeleteAccountSchema = z.object({
  confirmation: z.literal('DELETE MY ACCOUNT'),
});

router.delete(
  '/',
  requireAuth,
  requireStepUp,
  validate(DeleteAccountSchema),
  async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    await logAudit({ userId: user._id, event: 'account.delete', req });

    // Delete all user records
    await Promise.all([
      Item.deleteMany({ userId: user._id }),
      Folder.deleteMany({ userId: user._id }),
      Send.deleteMany({ ownerId: user._id }),
      Snapshot.deleteMany({ userId: user._id }),
      Session.deleteMany({ userId: user._id }),
      User.findByIdAndDelete(user._id),
    ]);

    // Clear refresh cookie
    res.clearCookie('vg_refresh', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });

    sendMail({
      to: user.email,
      subject: 'Account Deleted - VaultGuard',
      text: 'Your VaultGuard account and all associated encrypted vault items have been permanently deleted.',
    }).catch(() => {});

    res.json({ status: 'ok', message: 'Account and all data deleted permanently' });
  }
);

export default router;
