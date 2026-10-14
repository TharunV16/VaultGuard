import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordField from '../components/PasswordField.jsx';
import { deriveMasterKey, deriveAuthKey, deriveWrapKey, unwrapVaultKey, fromHex } from '../lib/crypto.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');

  const { dispatch, vaultKeyRef } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatusText('Fetching cryptographic parameters…');

    try {
      // 1. Prelogin
      const pre = await api('/api/v1/auth/prelogin', {
        method: 'POST',
        body: { email },
      });

      setStatusText('Deriving encryption keys…');
      // Yield to let UI render progress
      await new Promise((r) => setTimeout(r, 50));

      const saltBytes = fromHex(pre.kdf.salt);
      const masterKey = await deriveMasterKey(password, saltBytes);
      const authKey = await deriveAuthKey(masterKey);
      const wrapKey = await deriveWrapKey(masterKey);

      setStatusText('Authenticating…');

      // 2. Login
      const data = await api('/api/v1/auth/login', {
        method: 'POST',
        body: { email, authKey },
      });

      if (data.mfaRequired) {
        // Will be routed to MFA in Phase 3
        sessionStorage.setItem('vg_mfa', JSON.stringify({ mfaToken: data.mfaToken, methods: data.methods, email }));
        navigate('/login/mfa');
        return;
      }

      setStatusText('Unwrapping vault key…');
      const vaultKey = await unwrapVaultKey(data.wrappedVaultKey, wrapKey);

      // Store non-extractable key in memory ref only
      vaultKeyRef.current = vaultKey;

      dispatch({
        type: 'SESSION_RESTORED',
        accessToken: data.accessToken,
        wrappedVaultKey: data.wrappedVaultKey,
        user: data.user,
      });
      dispatch({ type: 'UNLOCKED' });

      toast('Vault unlocked successfully', 'success');
      navigate('/app');
    } catch (err) {
      if (err.data?.error?.code === 'LOCKED_OUT') {
        setError(`Account locked due to too many failed attempts. Try again in ${err.data.error.retryAfter} seconds.`);
      } else {
        setError(err.message || 'Invalid credentials');
      }
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Log In to VaultGuard</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Enter your email and master password to unlock your vault
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="you@domain.com"
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>

          <div>
            <PasswordField
              id="password"
              label="Master Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Your master password"
              disabled={loading}
            />
          </div>

          <div className="flex justify-end">
            <Link to="/recover" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              Forgot master password?
            </Link>
          </div>

          {statusText && (
            <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
              {statusText}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
          >
            {loading ? 'Unlocking…' : 'Log In & Unlock'}
          </button>
        </form>

        <div className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          Don't have a vault yet?{' '}
          <Link to="/register" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
