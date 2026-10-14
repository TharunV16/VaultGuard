// @ts-check
import mongoose from 'mongoose';

const ChallengeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['email_verify', 'email_otp', 'recovery', 'step_up', 'passkey_register', 'passkey_auth'],
      required: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index auto-deletes expired challenges
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

ChallengeSchema.index({ userId: 1, purpose: 1 });

export const Challenge = mongoose.model('Challenge', ChallengeSchema);
