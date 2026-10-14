import { useState, useRef } from 'react';
import MfaSetup from '../components/MfaSetup.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { ShieldCheck, User, KeyRound, Download, Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import {
  generateRecoveryKeyBytes,
  encodeRecoveryKey,
  deriveRecoveryWrapKey,
  deriveRecoveryVerifier,
  wrapVaultKey,
  deriveMasterKey,
  deriveAuthKey,
  fromHex,
} from '../lib/crypto.js';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('security');
  const { user, accessToken, vaultKeyRef } = useAuth();
  const { toast } = useToast();

  // Recovery Key Rotation state
  const [rotateLoading, setRotateLoading] = useState(false);
  const [rotateError, setRotateError] = useState('');
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [newRotatedKey, setNewRotatedKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState('');

  const stepUpDialogRef = useRef(null);
  const keyModalRef = useRef(null);

  const openRotateDialog = () => {
    setStepUpPassword('');
    setRotateError('');
    stepUpDialogRef.current?.showModal();
  };

  const handleRotateSubmit = async (e) => {
    e.preventDefault();
    setRotateError('');
    setRotateLoading(true);

    try {
      if (!vaultKeyRef.current) {
        throw new Error('Vault is locked. Please unlock your vault first.');
      }

      // 1. Step-up auth with master password
      const pre = await api('/api/v1/auth/prelogin', {
        method: 'POST',
        body: { email: user.email },
      });

      const saltBytes = fromHex(pre.kdf.salt);
      const masterKey = await deriveMasterKey(stepUpPassword, saltBytes);
      const authKey = await deriveAuthKey(masterKey);

      const stepUpRes = await api('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { authKey },
      });

      const stepUpToken = stepUpRes.stepUpToken;

      // 2. Generate new recovery key and wrap current vaultKey
      const newRecBytes = generateRecoveryKeyBytes();
      const newRecString = encodeRecoveryKey(newRecBytes);
      const newRecWrapKey = await deriveRecoveryWrapKey(newRecBytes);
      const newRecoveryWrappedVaultKey = await wrapVaultKey(vaultKeyRef.current, newRecWrapKey);
      const newRecoveryVerifier = await deriveRecoveryVerifier(newRecBytes);

      // 3. Post to rotate endpoint
      await api('/api/v1/me/recovery-key/rotate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-step-up-token': stepUpToken,
        },
        body: {
          recoveryWrappedVaultKey: newRecoveryWrappedVaultKey,
          recoveryVerifier: newRecoveryVerifier,
        },
      });

      stepUpDialogRef.current?.close();
      setNewRotatedKey(newRecString);
      setTypedConfirmation('');
      keyModalRef.current?.showModal();
      toast('Recovery key rotated successfully!', 'success');
    } catch (err) {
      setRotateError(err.message || 'Failed to rotate recovery key');
    } finally {
      setRotateLoading(false);
    }
  };

  const downloadNewKey = () => {
    const text = `VAULTGUARD RECOVERY KEY\n=======================\nAccount: ${user?.email}\nRotated: ${new Date().toISOString()}\n\nRECOVERY KEY:\n${newRotatedKey}\n\nIMPORTANT:\nKeep this key offline and safe. VaultGuard cannot restore your vault without it.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vaultguard-rotated-recovery-key-${user?.email?.split('@')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyNewKey = () => {
    navigator.clipboard.writeText(newRotatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const expectedLastGroup = newRotatedKey.split(' ').pop() || '';
  const isConfirmed = typedConfirmation.trim().toUpperCase() === expectedLastGroup.toUpperCase();

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Manage your account security, multi-factor authentication, and recovery key.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-1.5 py-2.5 px-4 font-medium border-b-2 transition ${
            activeTab === 'security'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          <ShieldCheck size={16} />
          Security & MFA
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('recovery')}
          className={`flex items-center gap-1.5 py-2.5 px-4 font-medium border-b-2 transition ${
            activeTab === 'recovery'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          <KeyRound size={16} />
          Recovery Key
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-1.5 py-2.5 px-4 font-medium border-b-2 transition ${
            activeTab === 'profile'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          <User size={16} />
          Profile
        </button>
      </div>

      {activeTab === 'security' && (
        <div className="space-y-6">
          <MfaSetup />
        </div>
      )}

      {activeTab === 'recovery' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <KeyRound size={20} className="text-indigo-600 dark:text-indigo-400" />
                  <h2 className="text-sm font-semibold">160-bit Emergency Recovery Key</h2>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-xl">
                  Your recovery key allows you to restore access to your encrypted vault if you forget your master password.
                  If you suspect your recovery key has been compromised or viewed by someone else, you can rotate it now.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
                <Check size={12} />
                Active
              </span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={openRotateDialog}
                className="inline-flex items-center gap-1.5 py-2 px-3.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition"
              >
                <RefreshCw size={14} />
                Rotate Recovery Key
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3">
          <h2 className="text-sm font-semibold">User Details</h2>
          <div className="text-xs space-y-1">
            <p><span className="text-neutral-400">Email:</span> {user?.email}</p>
            <p><span className="text-neutral-400">Role:</span> {user?.role}</p>
            <p><span className="text-neutral-400">Email Verified:</span> {user?.emailVerified ? 'Yes' : 'No'}</p>
          </div>
        </div>
      )}

      {/* Step-up Dialog for Rotation */}
      <dialog
        ref={stepUpDialogRef}
        className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 backdrop:bg-black/40 shadow-xl max-w-md w-full"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-amber-500" size={20} />
            <h3 className="text-sm font-semibold">Confirm Master Password</h3>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Rotating your recovery key invalidates your old key immediately. Re-enter your master password to proceed.
          </p>

          {rotateError && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900" role="alert">
              {rotateError}
            </div>
          )}

          <form onSubmit={handleRotateSubmit} className="space-y-4">
            <PasswordField
              id="stepUpPassword"
              label="Master Password"
              value={stepUpPassword}
              onChange={(e) => setStepUpPassword(e.target.value)}
              required
              disabled={rotateLoading}
              placeholder="Enter your master password"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => stepUpDialogRef.current?.close()}
                disabled={rotateLoading}
                className="py-1.5 px-3 text-xs font-medium rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={rotateLoading}
                className="py-1.5 px-3 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-1.5"
              >
                {rotateLoading && <RefreshCw size={12} className="animate-spin" />}
                {rotateLoading ? 'Rotating…' : 'Confirm Rotation'}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* Save New Rotated Key Modal */}
      <dialog
        ref={keyModalRef}
        className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 backdrop:bg-black/40 shadow-xl max-w-md w-full"
      >
        <div className="space-y-4">
          <div className="text-center space-y-1">
            <div className="inline-flex p-3 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 mb-1">
              <Check size={28} />
            </div>
            <h3 className="text-base font-bold">New Recovery Key Generated</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Your previous recovery key is now permanently invalid. Save this new key offline.
            </p>
          </div>

          <div className="p-3 bg-neutral-50 dark:bg-neutral-950 rounded border border-neutral-200 dark:border-neutral-800 space-y-2">
            <div
              className="font-mono text-xs tracking-wider text-center py-2 px-3 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded select-all break-words"
              aria-label="New recovery key value"
            >
              {newRotatedKey}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={downloadNewKey}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              >
                <Download size={14} />
                Download .txt
              </button>
              <button
                type="button"
                onClick={copyNewKey}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy Key'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmLastGroupRotate" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Confirm by typing the last group of 8 characters:
            </label>
            <input
              id="confirmLastGroupRotate"
              type="text"
              maxLength={8}
              autoComplete="off"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              placeholder="e.g. 7X89W..."
              className="w-full text-center font-mono tracking-widest uppercase px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            type="button"
            disabled={!isConfirmed}
            onClick={() => keyModalRef.current?.close()}
            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium rounded-lg text-xs transition"
          >
            I Have Saved My New Recovery Key
          </button>
        </div>
      </dialog>
    </div>
  );
}
