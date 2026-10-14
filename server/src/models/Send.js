// @ts-check
import mongoose from 'mongoose';

/**
 * SecureSend — stores E2E-encrypted one-time/expiring shares.
 * Key is NEVER stored here; it lives only in the URL fragment (SND-04).
 * SRS SND-01..03, AT-26.
 */
const SendSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** AES-256-GCM iv hex */
    iv: { type: String, required: true },
    /** AES-256-GCM ciphertext hex */
    ct: { type: String, required: true },
    /** Max number of views (1-20) */
    maxViews: { type: Number, required: true, min: 1, max: 20 },
    /** Atomic view counter */
    views: { type: Number, default: 0, min: 0 },
    /** Expiry time — Mongo TTL index will purge after this */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index: auto-purge expired sends (SRS SND-03)
SendSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Send = mongoose.model('Send', SendSchema);
