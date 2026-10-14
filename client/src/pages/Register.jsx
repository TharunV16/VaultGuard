import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordField from '../components/PasswordField.jsx';
import StrengthMeter from '../components/StrengthMeter.jsx';
import { evaluatePassword } from '../lib/strength.js';
import { checkBreach } from '../lib/hibp.js';
import {
  generateKdfSalt,
  kdfParams,
  deriveMasterKey,
  deriveAuthKey,
  deriveWrapKey,
  generateVaultKey,
  wrapVaultKey,
  generateRecoveryKeyBytes,
  encodeRecoveryKey,
  deriveRecoveryWrapKey,
  deriveRecoveryVerifier,
  fromHex,
} from '../lib/crypto.js';
import { api } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { ShieldCheck, Download, Copy, Check, ArrowRight } from 'lucide-react';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [statusText, setStatusText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2: Recovery key confirmation step
  const [recoveryKey, setRecoveryKey] = useState('');
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [copied, setCopied] = useState(false);

  const navigate = useNavigate();
  const { toast } = useToast();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 12) {
      setError('Master password must be at least 12 characters');
      return;
    }

    const { score } = evaluatePassword(password, [email]);
    if (score < 3) {
      setError('Password is too weak. Please choose a stronger passphrase or add more words.');
      return;
    }

    setLoading(true);
    setStatusText('Checking password against known breach lists…');

    try {
      const { breached, count } = await checkBreach(password);
      if (breached) {
        setLoading(false);
        setStatusText('');
        setError(`This password has appeared in ${count.toLocaleString()} data breaches. Please choose a different one.`);
        return;
      }

      setStatusText('Generating cryptographic keys… (this takes ~1 second)');
      // Yield to let UI update before heavy PBKDF2
      await new Promise((r) => setTimeout(r, 50));

      const saltHex = generateKdfSalt();
      const saltBytes = fromHex(saltHex);
      const masterKey = await deriveMasterKey(password, saltBytes);
      const authKey = await deriveAuthKey(masterKey);
      const wrapKey = await deriveWrapKey(masterKey);

      const vaultKey = await generateVaultKey();
      const wrappedVaultKey = await wrapVaultKey(vaultKey, wrapKey);

      const recBytes = generateRecoveryKeyBytes();
      const recString = encodeRecoveryKey(recBytes);
      const recWrapKey = await deriveRecoveryWrapKey(recBytes);
      const recoveryWrappedVaultKey = await wrapVaultKey(vaultKey, recWrapKey);
      const recoveryVerifier = await deriveRecoveryVerifier(recBytes);

      setStatusText('Creating your encrypted account…');

      await api('/api/v1/auth/register', {
        method: 'POST',
        body: {
          email,
          authKey,
          kdf: kdfParams(saltHex),
          wrappedVaultKey,
          recoveryWrappedVaultKey,
          recoveryVerifier,
        },
      });

      setRecoveryKey(recString);
      toast('Account registered! Save your recovery key.', 'success');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const downloadRecoveryKey = () => {
    const text = `VAULTGUARD RECOVERY KEY\n=======================\nAccount: ${email}\nGenerated: ${new Date().toISOString()}\n\nRECOVERY KEY:\n${recoveryKey}\n\nIMPORTANT:\nKeep this key offline and safe. VaultGuard cannot restore your vault without it.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vaultguard-recovery-key-${email.split('@')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyRecoveryKey = () => {
    navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const expectedLastGroup = recoveryKey.split(' ').pop() || '';
  const isConfirmed = typedConfirmation.trim().toUpperCase() === expectedLastGroup.toUpperCase();

  // If recovery key generated, show compulsory recovery key step
  if (recoveryKey) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-5">
          <div className="text-center space-y-1">
            <div className="inline-flex p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mb-1">
              <ShieldCheck size={28} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Save Your Recovery Key</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              This is the ONLY way to recover your vault if you ever forget your master password.
            </p>
          </div>

          <div className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 font-mono text-center tracking-wider text-sm select-all">
            {recoveryKey}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={downloadRecoveryKey}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 border border-neutral-300 dark:border-neutral-700 rounded-lg text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
            >
              <Download size={15} /> Download .txt
            </button>
            <button
              type="button"
              onClick={copyRecoveryKey}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 border border-neutral-300 dark:border-neutral-700 rounded-lg text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
            >
              {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy Key'}
            </button>
          </div>

          <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
            <label htmlFor="confirmKey" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Type the last group ({expectedLastGroup.length} characters) to confirm you saved it:
            </label>
            <input
              id="confirmKey"
              type="text"
              placeholder={expectedLastGroup}
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              className="w-full px-3 py-2 font-mono uppercase text-sm border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            type="button"
            disabled={!isConfirmed}
            onClick={() => navigate(`/verify-email?email=${encodeURIComponent(email)}`)}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium rounded-lg text-sm transition flex items-center justify-center gap-2"
          >
            Continue to Email Verification <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Create your Vault</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Zero-knowledge encryption. Only you hold the keys.
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
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
              autoComplete="new-password"
              placeholder="Minimum 12 characters"
              disabled={loading}
            />
            <StrengthMeter password={password} userInputs={[email]} />
          </div>

          <PasswordField
            id="confirmPassword"
            label="Confirm Master Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="Re-enter master password"
            disabled={loading}
          />

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
            {loading ? 'Creating Vault…' : 'Create Vault'}
          </button>
        </form>

        <div className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          Already have a vault?{' '}
          <Link to="/login" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
