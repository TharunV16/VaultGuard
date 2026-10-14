// @ts-check
import mongoose from 'mongoose';
import { logger } from './logger.js';

/**
 * Connect to MongoDB. Throws if connection fails.
 * @param {string} uri
 */
export async function connectDB(uri) {
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  await mongoose.connect(uri);
  logger.info('MongoDB connected');
}

/** Graceful close */
export async function closeDB() {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}
