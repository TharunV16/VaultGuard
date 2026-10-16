// @ts-check
import rateLimit from 'express-rate-limit';

// ponytail: per-process rate limiter, switch to a Redis store if running >1 instance

const windowMs = 15 * 60 * 1000; // 15 minutes

/** @param {object} opts */
function limiter(opts) {
  return rateLimit({
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => process.env.NODE_ENV !== 'production' && !req.headers['x-test-rate-limit'],
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' } });
    },
    ...opts,
  });
}

/** 300 / 15 min per IP — global (SRS Appendix C) */
export const globalLimiter = limiter({ limit: process.env.NODE_ENV === 'production' ? 300 : 5000 });

/** 10 / 15 min per IP for login/prelogin */
export const authLimiter = limiter({ limit: process.env.NODE_ENV === 'production' ? 10 : 500 });

/** 5 / hour for register/resend/recovery */
export const registerLimiter = limiter({
  limit: process.env.NODE_ENV === 'production' ? 5 : 200,
  windowMs: 60 * 60 * 1000,
});

/** 10 / 15 min for MFA verify */
export const mfaLimiter = limiter({ limit: process.env.NODE_ENV === 'production' ? 10 : 500 });

/** 30 / 15 min for send access */
export const sendAccessLimiter = limiter({ limit: process.env.NODE_ENV === 'production' ? 30 : 500 });

/** 600 / 15 min per user for vault routes */
export const vaultLimiter = limiter({ limit: process.env.NODE_ENV === 'production' ? 600 : 5000 });
