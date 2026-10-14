import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { setAuthHandlers } from '../lib/api.js';

/**
 * Auth state shape:
 * {
 *   status: 'loading' | 'unauthenticated' | 'locked' | 'unlocked',
 *   user: object | null,         // from /me (no secrets)
 *   accessToken: string | null,  // in memory only, never persisted
 *   wrappedVaultKey: object | null, // {iv, ct} — not a secret, comes from server
 * }
 */
const AuthContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case 'SESSION_RESTORED':
      // Refresh token worked; we have a new access token but vault is locked (key not in memory)
      return {
        ...state,
        status: 'locked',
        accessToken: action.accessToken,
        wrappedVaultKey: action.wrappedVaultKey,
        user: action.user ?? state.user,
      };
    case 'UNLOCKED':
      return { ...state, status: 'unlocked' };
    case 'LOCKED':
      return { ...state, status: 'locked' };
    case 'LOGGED_OUT':
      return { status: 'unauthenticated', user: null, accessToken: null, wrappedVaultKey: null };
    case 'USER_UPDATED':
      return { ...state, user: action.user };
    case 'TOKEN_REFRESHED':
      return { ...state, accessToken: action.accessToken };
    default:
      return state;
  }
}

const INITIAL_STATE = {
  status: 'loading',
  user: null,
  accessToken: null,
  wrappedVaultKey: null,
};

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  // vaultKey lives only in this ref — non-extractable CryptoKey, never serialized
  const vaultKeyRef = useRef(null);

  /** Attempt to restore session via refresh cookie */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'vaultguard' },
        });
        if (!res.ok) {
          dispatch({ type: 'LOGGED_OUT' });
          return;
        }
        const data = await res.json();
        dispatch({
          type: 'SESSION_RESTORED',
          accessToken: data.accessToken,
          wrappedVaultKey: data.wrappedVaultKey,
          user: data.user,
        });
      } catch {
        dispatch({ type: 'LOGGED_OUT' });
      }
    })();
  }, []);

  const lock = useCallback(() => {
    // Zero out vault key reference
    vaultKeyRef.current = null;
    dispatch({ type: 'LOCKED' });
  }, []);

  // Wire api.js handlers
  useEffect(() => {
    setAuthHandlers(
      () => state.accessToken,
      () => lock()
    );
  }, [state.accessToken, lock]);

  // Global Ctrl/Cmd+L lock shortcut (per skill.md §11)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lock();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lock]);

  const logout = useCallback(async (all = false) => {
    try {
      await fetch(`/api/v1/auth/logout${all ? '-all' : ''}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-Requested-With': 'vaultguard',
          Authorization: `Bearer ${state.accessToken}`,
        },
      });
    } catch {
      // ignore network errors on logout
    }
    vaultKeyRef.current = null;
    dispatch({ type: 'LOGGED_OUT' });
  }, [state.accessToken]);

  const value = {
    ...state,
    vaultKeyRef,
    dispatch,
    lock,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
