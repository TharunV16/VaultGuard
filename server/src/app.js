// @ts-check
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';
import authRouter from './routes/auth.js';
import mfaRouter from './routes/mfa.js';
import meRouter from './routes/me.js';
import vaultRouter from './routes/vault.js';
import sendRouter from './routes/send.js';

/**
 * Factory function — returns the configured Express app without binding a port.
 * Used by tests to get a fresh app instance.
 */
export function createApp() {
  const app = express();

  // ── Security headers (Helmet + CSP per SRS NFR-S2/S3) ───────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", 'https://api.pwnedpasswords.com'],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'"], // ponytail: unsafe-inline for styles only; scripts stay strict
          fontSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      permittedCrossDomainPolicies: false,
    })
  );

  // Permissions-Policy: deny camera/mic/geolocation per SRS NFR-S3
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()'
    );
    next();
  });

  // ── CORS ─────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: config.CLIENT_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'If-Match', 'x-step-up-token'],
      exposedHeaders: ['ETag'],
    })
  );

  // ── Logging ───────────────────────────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    })
  );

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(cookieParser());
  // 1 MB default; bulk import route overrides to 4 MB (per SRS NFR-S4)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // ── Global rate limit (300/15min per IP, per SRS Appendix C) ─────────────
  app.use('/api/v1', globalLimiter);

  // ── Cache-Control: no-store on all /api responses (SRS §4.1) ─────────────
  app.use('/api/v1', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/mfa', mfaRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/vault', vaultRouter);
  app.use('/api/v1/send', sendRouter);

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // ── Error handler (Express 5: async rejections auto-forwarded) ────────────
  app.use(errorHandler);

  return app;
}
