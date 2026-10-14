import mongoose from 'mongoose';

const SnapshotSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    at: {
      type: Date,
      default: Date.now,
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    counts: {
      weak: { type: Number, default: 0 },
      reused: { type: Number, default: 0 },
      breached: { type: Number, default: 0 },
      old: { type: Number, default: 0 },
      similar: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

SnapshotSchema.index({ userId: 1, at: -1 });

export const Snapshot = mongoose.model('Snapshot', SnapshotSchema);
