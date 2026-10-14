// @ts-check
import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    iv: {
      type: String,
      required: true,
      match: /^[0-9a-f]{24}$/i,
    },
    ct: {
      type: String,
      required: true,
      // max 64 KB = 131,072 hex chars
      maxlength: 131072,
    },
    rev: {
      type: Number,
      required: true,
      default: 1,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    purgeAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
itemSchema.index({ userId: 1, updatedAt: -1 });
itemSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 }); // TTL purge after 30 days

export const Item = mongoose.model('Item', itemSchema);
