// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Item } from '../models/Item.js';
import { Folder } from '../models/Folder.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../../lib/audit.js';

const router = Router();

// Protect all vault endpoints
router.use(requireAuth);

const Hex24Schema = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be 24-character hex');
const CiphertextSchema = z.string().min(1).max(131072).regex(/^[0-9a-f]+$/i, 'Must be valid hex');

const CreateItemSchema = z.object({
  _id: Hex24Schema.optional(),
  iv: Hex24Schema,
  ct: CiphertextSchema,
});

const UpdateItemSchema = z.object({
  iv: Hex24Schema,
  ct: CiphertextSchema,
});

const BulkItemsSchema = z.object({
  items: z.array(
    z.object({
      _id: Hex24Schema.optional(),
      iv: Hex24Schema,
      ct: CiphertextSchema,
    })
  ).min(1).max(500),
});

const FolderSchema = z.object({
  _id: Hex24Schema.optional(),
  iv: Hex24Schema,
  ct: z.string().min(1).max(16384).regex(/^[0-9a-f]+$/i),
});

// ── GET /vault/sync ───────────────────────────────────────────────────────────
router.get('/sync', async (req, res) => {
  const sinceQuery = req.query.since;
  let sinceDate = null;
  if (typeof sinceQuery === 'string' && sinceQuery.trim()) {
    const parsed = new Date(sinceQuery);
    if (!isNaN(parsed.getTime())) {
      sinceDate = parsed;
    }
  }

  const itemQuery = { userId: req.user.id };
  const folderQuery = { userId: req.user.id };

  if (sinceDate) {
    itemQuery.updatedAt = { $gt: sinceDate };
    folderQuery.updatedAt = { $gt: sinceDate };
  } else {
    // Initial sync returns active items and currently soft-deleted trash items (within 30 days)
    // so client has the complete state
  }

  const [items, folders] = await Promise.all([
    Item.find(itemQuery).sort({ updatedAt: -1 }).limit(5000).lean(),
    Folder.find(folderQuery).sort({ updatedAt: -1 }).limit(500).lean(),
  ]);

  res.json({
    items,
    folders,
    serverTime: new Date().toISOString(),
  });
});

// ── POST /vault/items ─────────────────────────────────────────────────────────
router.post('/items', validate(CreateItemSchema), async (req, res) => {
  const count = await Item.countDocuments({ userId: req.user.id, deletedAt: null });
  if (count >= 5000) {
    return res.status(400).json({
      error: { code: 'ITEM_CAP_EXCEEDED', message: 'Vault limit of 5,000 items reached' },
    });
  }

  const itemData = {
    userId: req.user.id,
    iv: req.body.iv,
    ct: req.body.ct,
    rev: 1,
  };

  if (req.body._id) {
    itemData._id = new mongoose.Types.ObjectId(req.body._id);
  }

  const item = await Item.create(itemData);
  res.status(201).json({ item });
});

// ── PUT /vault/items/:id (Optimistic Concurrency: If-Match) ───────────────────
router.put('/items/:id', validate(UpdateItemSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
  }

  const ifMatch = req.header('If-Match');
  if (!ifMatch) {
    return res.status(400).json({
      error: { code: 'REV_REQUIRED', message: 'If-Match header with item revision is required' },
    });
  }

  const expectedRev = parseInt(ifMatch, 10);
  if (isNaN(expectedRev)) {
    return res.status(400).json({
      error: { code: 'INVALID_REV', message: 'If-Match must be an integer revision' },
    });
  }

  const item = await Item.findOne({
    _id: req.params.id,
    userId: req.user.id,
    deletedAt: null,
  });

  if (!item) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
  }

  if (item.rev !== expectedRev) {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'Item has been modified by another session',
        currentItem: item,
      },
    });
  }

  item.iv = req.body.iv;
  item.ct = req.body.ct;
  item.rev = item.rev + 1;
  await item.save();

  res.json({ item });
});

// ── DELETE /vault/items/:id (Soft Delete / Move to Trash) ─────────────────────
router.delete('/items/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
  }

  const item = await Item.findOne({
    _id: req.params.id,
    userId: req.user.id,
    deletedAt: null,
  });

  if (!item) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
  }

  const now = new Date();
  const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30-day purge TTL

  item.deletedAt = now;
  item.purgeAt = purgeAt;
  item.rev = item.rev + 1;
  await item.save();

  res.json({ status: 'ok', item });
});

// ── POST /vault/items/:id/restore (Restore from Trash) ─────────────────────────
router.post('/items/:id/restore', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
  }

  const item = await Item.findOne({
    _id: req.params.id,
    userId: req.user.id,
    deletedAt: { $ne: null },
  });

  if (!item) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not in trash' } });
  }

  item.deletedAt = null;
  item.purgeAt = null;
  item.rev = item.rev + 1;
  await item.save();

  res.json({ status: 'ok', item });
});

// ── DELETE /vault/items/:id/permanent (Permanent Delete) ──────────────────────
router.delete('/items/:id/permanent', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
  }

  const result = await Item.deleteOne({
    _id: req.params.id,
    userId: req.user.id,
  });

  if (result.deletedCount === 0) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
  }

  res.json({ status: 'ok', message: 'Item permanently deleted' });
});

// ── DELETE /vault/trash (Empty Trash) ─────────────────────────────────────────
router.delete('/trash', async (req, res) => {
  const result = await Item.deleteMany({
    userId: req.user.id,
    deletedAt: { $ne: null },
  });

  res.json({ status: 'ok', deletedCount: result.deletedCount });
});

// ── POST /vault/items/bulk (Bulk Import) ──────────────────────────────────────
router.post('/items/bulk', validate(BulkItemsSchema), async (req, res) => {
  const currentCount = await Item.countDocuments({ userId: req.user.id, deletedAt: null });
  if (currentCount + req.body.items.length > 5000) {
    return res.status(400).json({
      error: { code: 'ITEM_CAP_EXCEEDED', message: 'Import exceeds 5,000 item capacity' },
    });
  }

  const docs = req.body.items.map((it) => ({
    userId: req.user.id,
    iv: it.iv,
    ct: it.ct,
    rev: 1,
    ...(it._id ? { _id: new mongoose.Types.ObjectId(it._id) } : {}),
  }));

  const inserted = await Item.insertMany(docs);
  res.status(201).json({ status: 'ok', count: inserted.length, items: inserted });
});

// ── Folders CRUD ─────────────────────────────────────────────────────────────
router.get('/folders', async (req, res) => {
  const folders = await Folder.find({ userId: req.user.id, deletedAt: null }).sort({ createdAt: 1 }).lean();
  res.json({ folders });
});

router.post('/folders', validate(FolderSchema), async (req, res) => {
  const folderData = {
    userId: req.user.id,
    iv: req.body.iv,
    ct: req.body.ct,
    rev: 1,
  };
  if (req.body._id) {
    folderData._id = new mongoose.Types.ObjectId(req.body._id);
  }
  const folder = await Folder.create(folderData);
  res.status(201).json({ folder });
});

router.put('/folders/:id', validate(FolderSchema.omit({ _id: true })), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Folder not found' } });
  }

  const folder = await Folder.findOne({ _id: req.params.id, userId: req.user.id, deletedAt: null });
  if (!folder) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Folder not found' } });
  }

  folder.iv = req.body.iv;
  folder.ct = req.body.ct;
  folder.rev = folder.rev + 1;
  await folder.save();

  res.json({ folder });
});

router.delete('/folders/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Folder not found' } });
  }

  const result = await Folder.deleteOne({ _id: req.params.id, userId: req.user.id });
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Folder not found' } });
  }

  res.json({ status: 'ok', message: 'Folder deleted' });
});

export default router;
