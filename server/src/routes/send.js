// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { Send } from '../models/Send.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendAccessLimiter } from '../middleware/rateLimit.js';
import { logAudit } from '../../lib/audit.js';

const router = Router();

const Hex24Schema = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be 24-character hex');
const CiphertextSchema = z.string().min(1).max(131072).regex(/^[0-9a-f]+$/i, 'Must be valid hex');

/** Valid expiry durations per SRS SND-01 */
const EXPIRY_DURATIONS = {
  '1h':  1 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const CreateSendSchema = z.object({
  iv: Hex24Schema,
  ct: CiphertextSchema,
  maxViews: z.number().int().min(1).max(20),
  expiresIn: z.enum(['1h', '24h', '7d', '30d']),
});

// ── POST /send — Create a new send (auth required) ────────────────────────────
router.post('/', requireAuth, validate(CreateSendSchema), async (req, res) => {
  const { iv, ct, maxViews, expiresIn } = req.body;

  const expiresAt = new Date(Date.now() + EXPIRY_DURATIONS[expiresIn]);

  const send = await Send.create({
    ownerId: req.user.id,
    iv,
    ct,
    maxViews,
    views: 0,
    expiresAt,
  });

  await logAudit({
    userId: req.user.id,
    event: 'send.create',
    req,
    meta: { sendId: send._id, maxViews, expiresIn },
  });

  res.status(201).json({ send: { _id: send._id, maxViews, views: 0, expiresAt } });
});

// ── GET /send — List owner's sends (auth required) ─────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const sends = await Send.find(
    { ownerId: req.user.id },
    { iv: 0, ct: 0 } // never return ciphertext in the list
  ).sort({ createdAt: -1 }).limit(100).lean();

  res.json({ sends });
});

// ── DELETE /send/:id — Revoke a send (auth required) ──────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const send = await Send.findOneAndDelete({ _id: req.params.id, ownerId: req.user.id });

  if (!send) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Send not found' } });
  }

  await logAudit({
    userId: req.user.id,
    event: 'send.revoke',
    req,
    meta: { sendId: req.params.id },
  });

  res.json({ status: 'ok', message: 'Send revoked' });
});

// ── POST /send/:id/access — Recipient consumes a view (public) ─────────────────
// Uses POST (never GET) so link previews/prefetch don't consume views (SRS SND-02)
router.post('/:id/access', sendAccessLimiter, async (req, res) => {
  // Atomic: increment views only if views < maxViews (SRS SND-02, AT-26)
  const send = await Send.findOneAndUpdate(
    {
      _id: req.params.id,
      expiresAt: { $gt: new Date() },
      $expr: { $lt: ['$views', '$maxViews'] },
    },
    { $inc: { views: 1 } },
    { new: false } // return pre-update doc to confirm it matched
  );

  if (!send) {
    // Either not found, expired, or view limit exhausted
    return res.status(410).json({ error: { code: 'GONE', message: 'This send has expired or reached its view limit.' } });
  }

  // Return iv+ct — key is NEVER stored here; it's in the URL fragment (SND-04)
  res.json({
    iv: send.iv,
    ct: send.ct,
    viewsUsed: send.views + 1, // views was pre-update value
    maxViews: send.maxViews,
  });
});

export default router;
