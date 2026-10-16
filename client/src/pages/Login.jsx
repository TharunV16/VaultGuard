import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordField from '../components/PasswordField.jsx';
import { deriveMasterKey, deriveAuthKey, deriveWrapKey, unwrapVaultKey, fromHex } from '../lib/crypto.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { startAuthentication } from '@simplewebauthn/browser';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');

  // MFA State
  const [mfaChallenge, setMfaChallenge] = useState(null); // { mfaToken, methods, wrapKey }
  const [selectedMethod, setSelectedMethod] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);

  const { dispatch, vaultKeyRef } = useAuth();
  const toastCtx = useToast();
  const toast = typeof toastCtx === 'function' ? toastCtx : (toastCtx?.toast || toastCtx?.addToast || (() => {}));
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
        setMfaChallenge({
          mfaToken: data.mfaToken,
          methods: data.methods,
          wrapKey,
        });
        setSelectedMethod(data.methods[0] || 'totp');
        setStatusText('');
        setLoading(false);
        return;
      }

      await finalizeLogin(data, wrapKey);
    } catch (err) {
      if (err.data?.error?.code === 'LOCKED_OUT') {
        setError(`Account locked due to too many failed attempts. Try again in ${err.data.error.retryAfter} seconds.`);
      } else {
        setError(err.message || 'Invalid credentials');
      }
      setLoading(false);
      setStatusText('');
    }
  };

  const finalizeLogin = async (data, wrapKey) => {
    setStatusText('Unwrapping vault key…');
    const vaultKey = await unwrapVaultKey(data.wrappedVaultKey, wrapKey);

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
  };

  const handleMfaSubmit = async (e) => {
    e?.preventDefault();
    if (!mfaChallenge) return;
    setError('');
    setLoading(true);

    try {
      let body = {
        mfaToken: mfaChallenge.mfaToken,
        method: selectedMethod,
        code: mfaCode.trim(),
      };

      if (selectedMethod === 'passkey') {
        setStatusText('Requesting passkey assertion…');
        const options = await api('/api/v1/auth/mfa/passkey/options', {
          method: 'POST',
          headers: { Authorization: `Bearer ${mfaChallenge.mfaToken}` },
        });

        const assertion = await startAuthentication({ optionsJSON: options });
        body = {
          mfaToken: mfaChallenge.mfaToken,
          method: 'passkey',
          response: assertion,
        };
      }

      setStatusText('Verifying second factor…');
      const data = await api('/api/v1/auth/mfa/verify', {
        method: 'POST',
        body,
      });

      await finalizeLogin(data, mfaChallenge.wrapKey);
    } catch (err) {
      setError(err.message || 'MFA verification failed');
      setLoading(false);
      setStatusText('');
    }
  };

  const handleSendEmailOtp = async () => {
    if (!mfaChallenge) return;
    setError('');
    setLoading(true);
    try {
      await api('/api/v1/auth/mfa/email/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mfaChallenge.mfaToken}` },
      });
      setEmailOtpSent(true);
      toast('Verification code sent to your email', 'info');
    } catch (err) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  // Render MFA Challenge Form
  if (mfaChallenge) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Two-Factor Authentication</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Verify your identity using your configured security factor
            </p>
          </div>

          {error && (
            <div role="alert" className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900">
              {error}
            </div>
          )}

          {/* Method selector tabs if multiple available */}
          {mfaChallenge.methods.length > 1 && (
            <div className="flex border-b border-neutral-200 dark:border-neutral-800 text-xs">
              {mfaChallenge.methods.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => {
                    setSelectedMethod(method);
                    setError('');
                    setMfaCode('');
                  }}
                  className={`flex-1 py-2 font-medium border-b-2 capitalize transition ${
                    selectedMethod === method
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                  }`}
                >
                  {method === 'totp' && 'Authenticator'}
                  {method === 'email_otp' && 'Email OTP'}
                  {method === 'backup_code' && 'Backup Code'}
                  {method === 'passkey' && 'Passkey'}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleMfaSubmit} className="space-y-4">
            {selectedMethod === 'totp' && (
              <div>
                <label htmlFor="mfaCode" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  6-Digit Authenticator Code
                </label>
                <input
                  id="mfaCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  disabled={loading}
                  placeholder="000000"
                  className="w-full text-center tracking-widest text-lg font-mono px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {selectedMethod === 'email_otp' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">
                    A code will be sent to your registered email
                  </span>
                  <button
                    type="button"
                    onClick={handleSendEmailOtp}
                    disabled={loading}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline disabled:opacity-50"
                  >
                    {emailOtpSent ? 'Resend code' : 'Send code'}
                  </button>
                </div>
                <div>
                  <label htmlFor="emailCode" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                    Enter Email Code
                  </label>
                  <input
                    id="emailCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    disabled={loading}
                    placeholder="123456"
                    className="w-full text-center tracking-widest text-lg font-mono px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            {selectedMethod === 'backup_code' && (
              <div>
                <label htmlFor="backupCode" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  10-Character Backup Code
                </label>
                <input
                  id="backupCode"
                  type="text"
                  maxLength={11}
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  disabled={loading}
                  placeholder="XXXXX-XXXXX"
                  className="w-full text-center tracking-wider text-base font-mono uppercase px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {selectedMethod === 'passkey' && (
              <div className="text-center py-2">
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-3">
                  Click below to use your device biometric, hardware key, or screen lock.
                </p>
                <button
                  type="button"
                  onClick={handleMfaSubmit}
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
                >
                  {loading ? 'Authenticating…' : 'Authenticate with Passkey'}
                </button>
              </div>
            )}

            {selectedMethod !== 'passkey' && (
              <button
                type="submit"
                disabled={loading || !mfaCode.trim()}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
              >
                {loading ? 'Verifying…' : 'Verify & Unlock'}
              </button>
            )}
          </form>

          {statusText && (
            <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 animate-pulse justify-center">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
              {statusText}
            </div>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setMfaChallenge(null);
                setMfaCode('');
                setError('');
              }}
              className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition"
            >
              ← Back to password login
            </button>
          </div>
        </div>
      </div>
    );
  }

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
