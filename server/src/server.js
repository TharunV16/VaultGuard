// @ts-check
import { createApp } from './app.js';
import { config } from './config.js';
import { connectDB, closeDB } from './db.js';
import { logger } from './logger.js';

const app = createApp();

async function boot() {
  await connectDB(config.MONGO_URI);

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'VaultGuard server started');
  });

  // Graceful shutdown (SIGTERM / SIGINT)
  async function shutdown(signal) {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(async () => {
      await closeDB();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

boot().catch((err) => {
  logger.error({ err }, 'Failed to boot');
  process.exit(1);
});
