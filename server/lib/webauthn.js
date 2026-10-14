// @ts-check
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { config } from '../src/config.js';

export const rpID = config.RP_ID;
export const rpName = config.RP_NAME;
export const origin = config.CLIENT_ORIGIN;

/**
 * Generate registration options for WebAuthn credential creation.
 * @param {object} user - { id: string, email: string }
 * @param {Array<{ id: string, transports?: any[] }>} [excludeCredentials]
 */
export async function getRegistrationOptions(user, excludeCredentials = []) {
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(user.id, 'hex'),
    userName: user.email,
    attestationType: 'none',
    excludeCredentials: excludeCredentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
}

/**
 * Verify registration response from client.
 * @param {any} response
 * @param {string} expectedChallenge
 */
export async function verifyRegistration(response, expectedChallenge) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
}

/**
 * Generate authentication options for passkey verification.
 * @param {Array<{ id: string, transports?: any[] }>} allowCredentials
 */
export async function getAuthenticationOptions(allowCredentials = []) {
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: allowCredentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    userVerification: 'preferred',
  });
}

/**
 * Verify authentication response from client.
 * @param {any} response
 * @param {string} expectedChallenge
 * @param {any} passkey - stored passkey { id, publicKey, counter, transports }
 */
export async function verifyAuthentication(response, expectedChallenge, passkey) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: passkey.id,
      credentialPublicKey: Buffer.from(passkey.publicKey, 'base64'),
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });
}
