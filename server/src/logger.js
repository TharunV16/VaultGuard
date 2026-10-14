// @ts-check
import pino from 'pino';
import { config } from './config.js';

/** @type {import('pino').Logger} */
export const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'password',
      'authKey',
      'token',
      'code',
      'secret',
      'cookie',
      'authorization',
      'wrappedVaultKey',
      'recoveryVerifier',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
  ...(config.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});
