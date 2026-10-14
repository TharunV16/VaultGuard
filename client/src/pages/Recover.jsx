import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import PasswordField from '../components/PasswordField.jsx';
import StrengthMeter from '../components/StrengthMeter.jsx';
import { evaluatePassword } from '../lib/strength.js';
import { checkBreach } from '../lib/hibp.js';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { startAuthentication } from '@simplewebauthn/browser';
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  generateRecoveryKeyBytes,
  deriveRecoveryWrapKey,
  deriveRecoveryVerifier,
  generateKdfSalt,
  kdfParams,
  deriveMasterKey,
  deriveAuthKey,
  deriveWrapKey,
  generateVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  fromHex,
} from '../lib/crypto.js';
import {
  KeyRound,
  ShieldAlert,
  AlertTriangle,
  Download,
  Copy,
  Check,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Mail,
} from 'lucide-react';

export default function Recover() {
  const [searchParams] = useSearchParams();
  const tokenParam = searchParams.get('token') || '';
  const emailParam = searchParams.get('email') || '';

  const [email, setEmail] = useState(emailParam);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  // Recovery Verification State
  const [recoverySession, setRecoverySession] = useState(null); // { recoveryToken, recoveryWrappedVaultKey, kdf }
  const [mfaChallenge, setMfaChallenge] = useState(null); // { methods }
  const [selectedMfaMethod, setSelectedMfaMethod] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);

  // Step: New Password & Recovery
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isResetMode, setIsResetMode] = useState(false); // Lost recovery key destructive wipe mode
  const [wipeConfirmation, setWipeConfirmation] = useState('');

  // Step: New Recovery Key Presentation
  const [newRecoveryKey, setNewRecoveryKey] = useState('');
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();
  const navigate = useNavigate();

  // If token & email are in URL, auto-verify token on mount
  useEffect(() => {
    if (tokenParam && emailParam) {
      handleVerifyRecoveryLink();
    }
  }, [tokenParam, emailParam]);

  // 1. Request recovery link by email
  const handleStartRecovery = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatusText('Sending recovery link…');

    try {
      await api('/api/v1/auth/recovery/start', {
        method: 'POST',
        body: { email: email.trim().toLowerCase() },
      });
      setEmailSent(true);
      toast('Recovery link sent! Check your email inbox.', 'info');
    } catch (err) {
      setError(err.message || 'Failed to send recovery instructions');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  // 2. Verify token from email link (with MFA check)
  const handleVerifyRecoveryLink = async (mfaPayload = {}) => {
    setError('');
    setLoading(true);
    setStatusText('Verifying recovery link…');

    try {
      const res = await api('/api/v1/auth/recovery/verify', {
        method: 'POST',
        body: {
          email: emailParam.trim().toLowerCase(),
          token: tokenParam.trim(),
          ...mfaPayload,
        },
      });

      if (res.mfaRequired) {
        setMfaChallenge({ methods: res.methods });
        setSelectedMfaMethod(res.methods[0] || 'totp');
        setLoading(false);
        setStatusText('');
        return;
      }

      setRecoverySession(res);
      setMfaChallenge(null);
    } catch (err) {
      setError(err.message || 'Recovery link is invalid or expired. Please request a new one.');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const handleMfaSubmit = async (e) => {
    e?.preventDefault();
    if (!selectedMfaMethod) return;

    if (selectedMfaMethod === 'passkey') {
      try {
        setLoading(true);
        setStatusText('Waiting for passkey…');
        const optsRes = await api('/api/v1/auth/mfa/passkey/options', {
          method: 'POST',
          body: { email: emailParam },
        });
        const assertion = await startAuthentication({ optionsJSON: optsRes });
        await handleVerifyRecoveryLink({
          method: 'passkey',
          response: assertion,
        });
      } catch (err) {
        setError(err.message || 'Passkey verification failed');
        setLoading(false);
        setStatusText('');
      }
      return;
    }

    await handleVerifyRecoveryLink({
      method: selectedMfaMethod,
      code: mfaCode.trim(),
    });
  };

  const handleSendEmailOtp = async () => {
    try {
      setLoading(true);
      await api('/api/v1/auth/mfa/email/send', {
        method: 'POST',
        body: { email: emailParam },
      });
      setEmailOtpSent(true);
      toast('Verification code sent to your email', 'info');
    } catch (err) {
      toast(err.message || 'Failed to send verification code', 'error');
    } finally {
      setLoading(false);
    }
  };

  // 3. Complete recovery with recovery key OR reset account
  const handleCompleteRecovery = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 12) {
      setError('Master password must be at least 12 characters');
      return;
    }

    const { score } = evaluatePassword(newPassword, [emailParam]);
    if (score < 3) {
      setError('Password is too weak. Please choose a stronger passphrase.');
      return;
    }

    setLoading(true);

    try {
      setStatusText('Checking password against breach lists…');
      const { breached, count } = await checkBreach(newPassword);
      if (breached) {
        setLoading(false);
        setStatusText('');
        setError(`This password has appeared in ${count.toLocaleString()} data breaches. Please choose a different one.`);
        return;
      }

      setStatusText('Generating new cryptographic key material…');
      await new Promise((r) => setTimeout(r, 50));

      const newSaltHex = generateKdfSalt();
      const newSaltBytes = fromHex(newSaltHex);
      const newMasterKey = await deriveMasterKey(newPassword, newSaltBytes);
      const newAuthKey = await deriveAuthKey(newMasterKey);
      const newWrapKey = await deriveWrapKey(newMasterKey);

      let targetVaultKey;
      let recoveryVerifier;

      if (!isResetMode) {
        // Standard Recovery with recovery key
        setStatusText('Decrypting vault key with recovery key…');
        const cleanRecKey = recoveryKeyInput.replace(/[\s-]/g, '').toUpperCase();
        if (cleanRecKey.length !== 32) {
          throw new Error('Recovery key must be 32 characters (grouped into 5 blocks)');
        }

        const recBytes = decodeRecoveryKey(cleanRecKey);
        const recWrapKey = await deriveRecoveryWrapKey(recBytes);

        try {
          targetVaultKey = await unwrapVaultKey(recoverySession.recoveryWrappedVaultKey, recWrapKey);
        } catch {
          throw new Error('Invalid recovery key. Unable to decrypt vault key.');
        }

        recoveryVerifier = await deriveRecoveryVerifier(recBytes);
      } else {
        // Lost Recovery Key Fallback: wipe and reset vault
        if (wipeConfirmation.trim() !== 'DELETE MY VAULT') {
          throw new Error('Please type DELETE MY VAULT to confirm account reset');
        }
        setStatusText('Generating brand new vault key…');
        targetVaultKey = await generateVaultKey();
      }

      // Re-wrap vaultKey with newWrapKey
      const newWrappedVaultKey = await wrapVaultKey(targetVaultKey, newWrapKey);

      // Generate a fresh 160-bit recovery key
      const newRecBytes = generateRecoveryKeyBytes();
      const newRecString = encodeRecoveryKey(newRecBytes);
      const newRecWrapKey = await deriveRecoveryWrapKey(newRecBytes);
      const newRecoveryWrappedVaultKey = await wrapVaultKey(targetVaultKey, newRecWrapKey);
      const newRecoveryVerifier = await deriveRecoveryVerifier(newRecBytes);

      setStatusText('Updating security credentials…');

      if (!isResetMode) {
        await api('/api/v1/auth/recovery/complete', {
          method: 'POST',
          body: {
            recoveryToken: recoverySession.recoveryToken,
            recoveryVerifier,
            newAuthKey,
            newKdf: kdfParams(newSaltHex),
            newWrappedVaultKey,
            newRecoveryWrappedVaultKey,
            newRecoveryVerifier,
          },
        });
      } else {
        await api('/api/v1/auth/recovery/reset-account', {
          method: 'POST',
          body: {
            recoveryToken: recoverySession.recoveryToken,
            confirmation: 'DELETE MY VAULT',
            newAuthKey,
            newKdf: kdfParams(newSaltHex),
            newWrappedVaultKey,
            newRecoveryWrappedVaultKey,
            newRecoveryVerifier,
          },
        });
      }

      setNewRecoveryKey(newRecString);
      toast(
        isResetMode
          ? 'Account reset successful! Save your new recovery key.'
          : 'Vault recovered! Save your new recovery key.',
        'success'
      );
    } catch (err) {
      setError(err.message || 'Recovery failed. Please try again.');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const downloadRecoveryKey = () => {
    const text = `VAULTGUARD RECOVERY KEY\n=======================\nAccount: ${emailParam}\nGenerated: ${new Date().toISOString()}\n\nRECOVERY KEY:\n${newRecoveryKey}\n\nIMPORTANT:\nKeep this key offline and safe. VaultGuard cannot restore your vault without it.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vaultguard-new-recovery-key-${emailParam.split('@')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyRecoveryKey = () => {
    navigator.clipboard.writeText(newRecoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const expectedLastGroup = newRecoveryKey.split(' ').pop() || '';
  const isConfirmed = typedConfirmation.trim().toUpperCase() === expectedLastGroup.toUpperCase();

  // ── Step 4: Compulsory Save New Recovery Key ─────────────────────────────
  if (newRecoveryKey) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-5">
          <div className="text-center space-y-1">
            <div className="inline-flex p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mb-1">
              <ShieldCheck size={28} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Save Your New Recovery Key</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Your previous recovery key has been invalidated. Save this new key offline now.
            </p>
          </div>

          <div className="p-4 bg-neutral-50 dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800 space-y-2">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              New 160-bit Recovery Key
            </label>
            <div
              className="font-mono text-sm tracking-wider text-center py-2 px-3 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded select-all break-words"
              aria-label="Recovery key value"
            >
              {newRecoveryKey}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={downloadRecoveryKey}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-medium rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              >
                <Download size={14} />
                Download .txt
              </button>
              <button
                type="button"
                onClick={copyRecoveryKey}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-medium rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy Key'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="confirm-last-group"
              className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
            >
              Confirm by typing the last group of 8 characters:
            </label>
            <input
              id="confirm-last-group"
              type="text"
              maxLength={8}
              autoComplete="off"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              placeholder="e.g. 7X89W..."
              className="w-full text-center font-mono tracking-widest uppercase px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {typedConfirmation && !isConfirmed && (
              <p className="text-xs text-rose-500 text-center" role="alert">
                Does not match the last group of your key.
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={!isConfirmed}
            onClick={() => navigate('/login')}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium rounded-lg text-sm transition flex items-center justify-center gap-1.5"
          >
            <span>Continue to Log In</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: MFA Challenge during recovery ─────────────────────────────────
  if (mfaChallenge) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-5">
          <div className="text-center space-y-1">
            <div className="inline-flex p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mb-1">
              <ShieldAlert size={28} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Two-Factor Verification</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Confirm your identity before recovering your account.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </div>
          )}

          {mfaChallenge.methods.length > 1 && (
            <div className="flex border-b border-neutral-200 dark:border-neutral-800 text-xs">
              {mfaChallenge.methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMfaMethod(m)}
                  className={`py-2 px-3 font-medium border-b-2 capitalize transition ${
                    selectedMfaMethod === m
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  {m.replace('_', ' ')}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleMfaSubmit} className="space-y-4">
            {selectedMfaMethod === 'totp' && (
              <div>
                <label htmlFor="mfaCode" className="block text-sm font-medium mb-1">
                  6-Digit Authenticator Code
                </label>
                <input
                  id="mfaCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  disabled={loading}
                  placeholder="000000"
                  className="w-full text-center tracking-widest text-lg font-mono px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {selectedMfaMethod === 'email_otp' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Code sent to {emailParam}</span>
                  <button
                    type="button"
                    onClick={handleSendEmailOtp}
                    disabled={loading}
                    className="text-indigo-600 hover:underline disabled:opacity-50 font-medium"
                  >
                    {emailOtpSent ? 'Resend' : 'Send Code'}
                  </button>
                </div>
                <div>
                  <label htmlFor="emailOtpCode" className="block text-sm font-medium mb-1">
                    6-Digit Email Code
                  </label>
                  <input
                    id="emailOtpCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    disabled={loading}
                    placeholder="000000"
                    className="w-full text-center tracking-widest text-lg font-mono px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            {selectedMfaMethod === 'backup_code' && (
              <div>
                <label htmlFor="backupCode" className="block text-sm font-medium mb-1">
                  Backup Code
                </label>
                <input
                  id="backupCode"
                  type="text"
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  disabled={loading}
                  placeholder="e.g. 7X89-W24K"
                  className="w-full text-center font-mono uppercase tracking-wider px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {selectedMfaMethod === 'passkey' && (
              <div className="p-4 text-center rounded-lg border border-neutral-200 dark:border-neutral-800 space-y-2">
                <p className="text-xs text-neutral-500">
                  Authenticate with your registered security key, Touch ID, or Windows Hello.
                </p>
              </div>
            )}

            {statusText && (
              <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400">
                <RefreshCw size={14} className="animate-spin" />
                {statusText}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
            >
              {loading ? 'Verifying…' : selectedMfaMethod === 'passkey' ? 'Use Passkey' : 'Verify & Continue'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Step 2: Validated Recovery Link → Set New Password & Recovery Key ───────
  if (recoverySession) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-5">
          <div className="text-center space-y-1">
            <div className="inline-flex p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mb-1">
              <KeyRound size={28} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              {isResetMode ? 'Reset Account & Wipe Vault' : 'Recover Your Vault'}
            </h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Account: <span className="font-medium text-neutral-700 dark:text-neutral-200">{emailParam}</span>
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </div>
          )}

          {!isResetMode ? (
            <form onSubmit={handleCompleteRecovery} className="space-y-4">
              <div>
                <label htmlFor="recoveryKeyInput" className="block text-sm font-medium mb-1">
                  160-bit Recovery Key
                </label>
                <input
                  id="recoveryKeyInput"
                  type="text"
                  required
                  autoComplete="off"
                  value={recoveryKeyInput}
                  onChange={(e) => setRecoveryKeyInput(e.target.value)}
                  disabled={loading}
                  placeholder="XXXXXXX XXXXXXX XXXXXXX XXXXXXX XXXXXXX"
                  className="w-full font-mono text-center tracking-wider uppercase px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  The 32-character recovery key saved when you registered.
                </p>
              </div>

              <div>
                <PasswordField
                  id="newPassword"
                  label="New Master Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={loading}
                  placeholder="At least 12 characters"
                />
                <StrengthMeter password={newPassword} userInputs={[emailParam]} />
              </div>

              <div>
                <PasswordField
                  id="confirmPassword"
                  label="Confirm New Master Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={loading}
                  placeholder="Repeat new master password"
                />
              </div>

              {statusText && (
                <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400">
                  <RefreshCw size={14} className="animate-spin" />
                  {statusText}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
              >
                {loading ? 'Recovering Vault…' : 'Restore Vault & Set Password'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(true);
                    setError('');
                  }}
                  className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                >
                  Lost your recovery key? Click here for account reset.
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCompleteRecovery} className="space-y-4">
              <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={16} />
                  <span>Destructive Account Reset</span>
                </div>
                <p>
                  Because VaultGuard is zero-knowledge, we cannot decrypt your vault without your recovery key.
                  Resetting will <strong>permanently delete all encrypted credentials</strong> and create a fresh vault.
                </p>
              </div>

              <div>
                <label htmlFor="wipeConfirmation" className="block text-xs font-semibold text-rose-600 dark:text-rose-400 mb-1">
                  Type DELETE MY VAULT to confirm:
                </label>
                <input
                  id="wipeConfirmation"
                  type="text"
                  required
                  autoComplete="off"
                  value={wipeConfirmation}
                  onChange={(e) => setWipeConfirmation(e.target.value)}
                  disabled={loading}
                  placeholder="DELETE MY VAULT"
                  className="w-full text-center font-mono tracking-wider px-3 py-2 border border-rose-300 dark:border-rose-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <PasswordField
                  id="resetPassword"
                  label="New Master Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={loading}
                  placeholder="At least 12 characters"
                />
                <StrengthMeter password={newPassword} userInputs={[emailParam]} />
              </div>

              <div>
                <PasswordField
                  id="confirmResetPassword"
                  label="Confirm New Master Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={loading}
                  placeholder="Repeat new master password"
                />
              </div>

              {statusText && (
                <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
                  <RefreshCw size={14} className="animate-spin" />
                  {statusText}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || wipeConfirmation.trim() !== 'DELETE MY VAULT'}
                className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
              >
                {loading ? 'Resetting Account…' : 'Wipe Vault & Reset Account'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(false);
                    setError('');
                  }}
                  className="text-xs text-neutral-500 hover:underline"
                >
                  ← Back to recovery key entry
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Step 1: Initial Email Request Form ────────────────────────────────────
  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-5">
        <div className="text-center space-y-1">
          <div className="inline-flex p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mb-1">
            <KeyRound size={28} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Account Recovery</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Forgot your master password? We will email you a secure link to initiate vault recovery.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400" role="alert">
            {error}
          </div>
        )}

        {emailSent ? (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-center space-y-3">
            <div className="inline-flex p-2 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400">
              <Mail size={24} />
            </div>
            <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Recovery Link Sent</h2>
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              If an account exists for <span className="font-semibold">{email}</span>, a recovery link has been sent. The link expires in 15 minutes.
            </p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              In development mode, check your server console log to view the link.
            </p>
            <div className="pt-2">
              <Link to="/login" className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
                Return to Login
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleStartRecovery} className="space-y-4">
            <div>
              <label htmlFor="recoveryEmail" className="block text-sm font-medium mb-1">
                Email Address
              </label>
              <input
                id="recoveryEmail"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@domain.com"
                className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {statusText && (
              <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400">
                <RefreshCw size={14} className="animate-spin" />
                {statusText}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
            >
              {loading ? 'Sending link…' : 'Send Recovery Link'}
            </button>
          </form>
        )}

        <div className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          Remember your password?{' '}
          <Link to="/login" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
            Log In
          </Link>
        </div>
      </div>
    </div>
  );
}
