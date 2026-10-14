// @ts-check
import mongoose from 'mongoose';

const AuditSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    event: {
      type: String,
      required: true,
      index: true,
    },
    ipPrefix: {
      type: String,
      default: '',
    },
    ua: {
      type: String,
      default: '',
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    at: {
      type: Date,
      default: Date.now,
      index: { expires: 365 * 24 * 60 * 60 }, // 365-day retention TTL
    },
  },
  { timestamps: false }
);

// Compound index for user timeline queries: (userId, at desc)
AuditSchema.index({ userId: 1, at: -1 });

export const Audit = mongoose.model('Audit', AuditSchema);
