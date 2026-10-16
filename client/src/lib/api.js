/**
 * client/src/lib/api.js
 * Minimal fetch wrapper for VaultGuard API.
 * Never logs secrets. Automatically attaches Authorization header.
 */

let getAccessToken = () => null;
let onTokenExpired = () => {};

/**
 * Configure token providers from AuthContext.
 * @param {() => string | null} getToken
 * @param {() => void} onExpired
 */
export function setAuthHandlers(getToken, onExpired) {
  getAccessToken = getToken;
  onTokenExpired = onExpired;
}

/**
 * Make an API request.
 * @param {string} endpoint - path like '/api/v1/vault/items'
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function api(endpoint, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'vaultguard');

  const token = getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
    onTokenExpired();
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    let msg = data?.error?.message;
    if (!msg) {
      if (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
        msg = 'Server connection error. Please verify the backend is running and try again.';
      } else {
        msg = `Request failed with status ${res.status}`;
      }
    }
    const error = new Error(msg);
    // @ts-ignore
    error.status = res.status;
    // @ts-ignore
    error.code = data?.error?.code;
    // @ts-ignore
    error.data = data;
    throw error;
  }

  return data;
}
