// @ts-check
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    kdf: {
      algo: { type: String, default: 'PBKDF2-SHA256' },
      iterations: { type: Number, default: 600000 },
      salt: { type: String, required: true },
    },
    authHash: {
      salt: { type: String, required: true },
      hash: { type: String, required: true },
    },
    wrappedVaultKey: {
      iv: { type: String, required: true },
      ct: { type: String, required: true },
    },
    recoveryWrappedVaultKey: {
      iv: { type: String, required: true },
      ct: { type: String, required: true },
    },
    recoveryVerifierHash: {
      type: String,
      required: true,
    },
    mfa: {
      totp: {
        enabled: { type: Boolean, default: false },
        secret: { type: String }, // encrypted at rest with server key
        lastStep: { type: Number },
      },
      emailOtp: {
        enabled: { type: Boolean, default: false },
      },
      backupCodes: [
        {
          codeHash: { type: String, required: true },
          used: { type: Boolean, default: false },
          usedAt: { type: Date },
        },
      ],
      passkeys: [
        {
          id: { type: String, required: true },
          publicKey: { type: String, required: true },
          counter: { type: Number, default: 0 },
          deviceType: { type: String },
          backedUp: { type: Boolean, default: false },
          transports: [String],
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
    lockout: {
      attempts: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
    },
    settings: {
      autoLockMinutes: { type: Number, default: 5 },
      clipboardSeconds: { type: Number, default: 30 },
      breachAutoScan: { type: Boolean, default: true },
      snapshotsOptIn: { type: Boolean, default: false },
      theme: { type: String, default: 'system' },
      generatorDefaults: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', UserSchema);
