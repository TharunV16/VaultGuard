// @ts-check
import nodemailer from 'nodemailer';
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';

let transporter;

try {
  if (config.SMTP_URL) {
    transporter = nodemailer.createTransport(config.SMTP_URL);
  }
} catch (err) {
  logger.error({ err }, '[mail] Failed to initialize SMTP transport, falling back to console');
}

if (!transporter) {
  // Development / test console transport: logs email safely without secrets in pino
  transporter = {
    async sendMail(opts) {
      if (process.env.NODE_ENV !== 'test') {
        logger.info(
          { to: opts.to, subject: opts.subject, text: opts.text },
          '[mail] Outgoing email (dev mode console transport)'
        );
      }
      return { messageId: `dev-${Date.now()}` };
    },
  };
}

/**
 * Send an email.
 * @param {{ to: string, subject: string, text: string, html?: string }} options
 */
export async function sendMail({ to, subject, text, html }) {
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    const codeMatch = text?.match(/code is:\s*([A-Za-z0-9_-]+)/i);
    if (codeMatch) {
      console.log(`[email] Verification code for ${to}: ${codeMatch[1]}`);
    }
  }
  try {
    return await transporter.sendMail({
      from: config.MAIL_FROM,
      to,
      subject,
      text,
      html: html || text,
    });
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email');
    throw err;
  }
}
