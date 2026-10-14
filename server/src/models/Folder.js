// @ts-check
import mongoose from 'mongoose';

const folderSchema = new mongoose.Schema(
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
      maxlength: 16384,
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
  },
  {
    timestamps: true,
  }
);

folderSchema.index({ userId: 1 });

export const Folder = mongoose.model('Folder', folderSchema);
