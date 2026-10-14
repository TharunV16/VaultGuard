// @ts-check
import { Audit } from '../src/models/Audit.js';
import { logger } from '../src/logger.js';

/**
 * Extract coarse IP prefix for privacy (first 3 octets IPv4, /48 IPv6).
 * @param {string|undefined} ip
 * @returns {string}
 */
export function getCoarseIp(ip = '') {
  if (!ip) return 'unknown';
  // Strip IPv6-mapped IPv4 prefix if present
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  } else if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}::/48`;
  }
  return ip;
}

/**
 * Build a human-readable device label from User-Agent and IP.
 * @param {string} [ua]
 * @param {string} [ip]
 * @returns {string}
 */
export function getDeviceLabel(ua = '', ip = '') {
  let browser = 'Unknown browser';
  if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/')) browser = 'Safari';

  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return `${browser} on ${os}`;
}

/**
 * Log an audit entry to MongoDB.
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId
 * @param {string} params.event
 * @param {import('express').Request} [params.req]
 * @param {object} [params.meta]
 */
export async function logAudit({ userId, event, req, meta = {} }) {
  try {
    const ip = req ? (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket?.remoteAddress) : '';
    const ua = req ? req.headers['user-agent'] || '' : '';
    await Audit.create({
      userId,
      event,
      ipPrefix: getCoarseIp(ip),
      ua,
      meta,
      at: new Date(),
    });
  } catch (err) {
    logger.error({ err, event, userId }, 'Failed to record audit event');
  }
}
