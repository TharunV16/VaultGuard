import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ShieldCheck,
  Smartphone,
  Mail,
  Fingerprint,
  KeyRound,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { deriveMasterKey, deriveAuthKey, fromHex } from '../lib/crypto.js';
import { startRegistration } from '@simplewebauthn/browser';

export default function MfaSetup() {
  const { user, accessToken } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [passkeys, setPasskeys] = useState([]);

  // Modals & Sub-flows
  const [totpSetupData, setTotpSetupData] = useState(null); // { secret, uri }
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [generatedBackupCodes, setGeneratedBackupCodes] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Step-Up Dialog State
  const [pendingAction, setPendingAction] = useState(null); // { fn: callback, title: string }
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpMfaCode, setStepUpMfaCode] = useState('');
  const [stepUpError, setStepUpError] = useState('');
  const [stepUpLoading, setStepUpLoading] = useState(false);

  // Passkey name input
  const [newPasskeyName, setNewPasskeyName] = useState('');
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);

  const stepUpDialogRef = useRef(null);
  const totpDialogRef = useRef(null);
  const backupCodesDialogRef = useRef(null);
  const passkeyDialogRef = useRef(null);

  const loadMfaStatus = async () => {
    try {
      setLoading(true);
      const [meRes, pkRes] = await Promise.all([
        api('/api/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } }),
        api('/api/v1/mfa/passkeys', { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      setProfile(meRes.user);
      setPasskeys(pkRes.passkeys || []);
    } catch (err) {
      toast(err.message || 'Failed to load MFA settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) {
      loadMfaStatus();
    }
  }, [accessToken]);

  // ── Step-Up execution wrapper ─────────────────────────────────────────────
  const executeWithStepUp = (actionTitle, actionFn) => {
    setPendingAction({ fn: actionFn, title: actionTitle });
    setStepUpPassword('');
    setStepUpMfaCode('');
    setStepUpError('');
    stepUpDialogRef.current?.showModal();
  };

  const handleStepUpSubmit = async (e) => {
    e.preventDefault();
    setStepUpError('');
    setStepUpLoading(true);

    try {
      // 1. Get KDF params
      const pre = await api('/api/v1/auth/prelogin', {
        method: 'POST',
        body: { email: user.email },
      });

      const saltBytes = fromHex(pre.kdf.salt);
      const masterKey = await deriveMasterKey(stepUpPassword, saltBytes);
      const authKey = await deriveAuthKey(masterKey);

      // 2. Step-up request
      const stepUpPayload = {
        authKey,
        ...(profile?.mfa?.totpEnabled && stepUpMfaCode
          ? { method: 'totp', code: stepUpMfaCode.trim() }
          : {}),
      };

      const stepUpRes = await api('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: stepUpPayload,
      });

      stepUpDialogRef.current?.close();

      // 3. Execute pending action with stepUpToken
      if (pendingAction?.fn) {
        await pendingAction.fn(stepUpRes.stepUpToken);
      }
    } catch (err) {
      if (err.data?.error?.code === 'MFA_REQUIRED') {
        setStepUpError('Authenticator code is required to step-up.');
      } else {
        setStepUpError(err.message || 'Step-up verification failed');
      }
    } finally {
      setStepUpLoading(false);
    }
  };

  // ── TOTP Setup ────────────────────────────────────────────────────────────
  const startTotpSetup = async () => {
    try {
      const data = await api('/api/v1/mfa/totp/setup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setTotpSetupData(data);
      setTotpCode('');
      setTotpError('');
      totpDialogRef.current?.showModal();
    } catch (err) {
      toast(err.message || 'Failed to start TOTP setup', 'error');
    }
  };

  const confirmTotpEnable = async (e) => {
    e.preventDefault();
    setTotpError('');
    try {
      const res = await api('/api/v1/mfa/totp/enable', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { code: totpCode.trim() },
      });

      totpDialogRef.current?.close();
      toast('Authenticator app enabled successfully', 'success');

      if (res.backupCodes?.length) {
        setGeneratedBackupCodes(res.backupCodes);
        backupCodesDialogRef.current?.showModal();
      }

      loadMfaStatus();
    } catch (err) {
      setTotpError(err.message || 'Invalid verification code');
    }
  };

  const disableTotp = () => {
    executeWithStepUp('Disable Authenticator App', async (stepUpToken) => {
      await api('/api/v1/mfa/totp', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Step-Up-Token': stepUpToken,
        },
      });
      toast('Authenticator app removed', 'info');
      loadMfaStatus();
    });
  };

  // ── Backup Codes ──────────────────────────────────────────────────────────
  const regenerateBackupCodes = () => {
    executeWithStepUp('Regenerate Backup Codes', async (stepUpToken) => {
      const res = await api('/api/v1/mfa/backup-codes/regenerate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Step-Up-Token': stepUpToken,
        },
      });
      setGeneratedBackupCodes(res.backupCodes);
      backupCodesDialogRef.current?.showModal();
      toast('New backup codes generated', 'success');
      loadMfaStatus();
    });
  };

  // ── Email OTP ─────────────────────────────────────────────────────────────
  const toggleEmailOtp = async () => {
    if (profile?.mfa?.emailOtpEnabled) {
      executeWithStepUp('Disable Email OTP', async (stepUpToken) => {
        await api('/api/v1/mfa/email/disable', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Step-Up-Token': stepUpToken,
          },
        });
        toast('Email OTP disabled', 'info');
        loadMfaStatus();
      });
    } else {
      try {
        await api('/api/v1/mfa/email/enable', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        toast('Email OTP enabled', 'success');
        loadMfaStatus();
      } catch (err) {
        toast(err.message || 'Failed to enable Email OTP', 'error');
      }
    }
  };

  // ── Passkeys ──────────────────────────────────────────────────────────────
  const handleAddPasskey = () => {
    setNewPasskeyName('');
    passkeyDialogRef.current?.showModal();
  };

  const startPasskeyEnrollment = async (e) => {
    e.preventDefault();
    passkeyDialogRef.current?.close();

    executeWithStepUp('Add Passkey', async (stepUpToken) => {
      try {
        const options = await api('/api/v1/mfa/passkeys/register/options', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Step-Up-Token': stepUpToken,
          },
        });

        const registrationResponse = await startRegistration({ optionsJSON: options });

        await api('/api/v1/mfa/passkeys/register/verify', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Step-Up-Token': stepUpToken,
          },
          body: {
            response: registrationResponse,
            name: newPasskeyName.trim() || 'My Passkey',
          },
        });

        toast('Passkey added successfully', 'success');
        loadMfaStatus();
      } catch (err) {
        toast(err.message || 'Passkey creation cancelled or failed', 'error');
      }
    });
  };

  const deletePasskey = (id, name) => {
    executeWithStepUp(`Remove Passkey "${name}"`, async (stepUpToken) => {
      await api(`/api/v1/mfa/passkeys/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Step-Up-Token': stepUpToken,
        },
      });
      toast('Passkey removed', 'info');
      loadMfaStatus();
    });
  };

  if (loading && !profile) {
    return <div className="p-4 text-xs text-neutral-500 animate-pulse">Loading MFA settings…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <ShieldCheck size={20} className="text-indigo-600 dark:text-indigo-400" />
          Multi-Factor Authentication
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Add additional layers of defense to your vault. Sensitive changes require master password re-authentication (Step-Up).
        </p>
      </div>

      <div className="grid gap-4">
        {/* 1. TOTP Authenticator */}
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 flex items-start justify-between">
          <div className="flex gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <Smartphone size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Authenticator App (TOTP)</h3>
                {profile?.mfa?.totpEnabled ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    Active
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                    Disabled
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Generate 6-digit verification codes using Google Authenticator, Bitwarden, 1Password, or Authy.
              </p>
            </div>
          </div>
          <div>
            {profile?.mfa?.totpEnabled ? (
              <button
                type="button"
                onClick={disableTotp}
                className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg transition"
              >
                Disable
              </button>
            ) : (
              <button
                type="button"
                onClick={startTotpSetup}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition"
              >
                Set Up
              </button>
            )}
          </div>
        </div>

        {/* 2. Email OTP */}
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 flex items-start justify-between">
          <div className="flex gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <Mail size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Email Security Codes</h3>
                {profile?.mfa?.emailOtpEnabled ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    Active
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                    Disabled
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Receive single-use verification codes at your verified email address ({profile?.email}).
              </p>
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={toggleEmailOtp}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                profile?.mfa?.emailOtpEnabled
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {profile?.mfa?.emailOtpEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>

        {/* 3. Passkeys (WebAuthn) */}
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex gap-3">
              <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                <Fingerprint size={20} />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Passkeys & Security Keys</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Sign in with Windows Hello, Touch ID, Face ID, or a FIDO2 hardware security key.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddPasskey}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition"
            >
              <Plus size={14} />
              Add Passkey
            </button>
          </div>

          {passkeys.length > 0 ? (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800 border-t border-neutral-100 dark:border-neutral-800 pt-2">
              {passkeys.map((pk) => (
                <div key={pk.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">{pk.name}</span>
                    <span className="ml-2 text-neutral-400">
                      Added {new Date(pk.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deletePasskey(pk.id, pk.name)}
                    aria-label={`Remove passkey ${pk.name}`}
                    className="p-1 text-neutral-400 hover:text-red-600 transition"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400 italic pt-1">No passkeys registered yet.</p>
          )}
        </div>

        {/* 4. Backup Codes */}
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 flex items-start justify-between">
          <div className="flex gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <KeyRound size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Emergency Backup Codes</h3>
                {profile?.mfa?.hasBackupCodes ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    Active
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                    None generated
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Single-use emergency codes to access your account if you lose your phone or authenticator app.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={regenerateBackupCodes}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-lg transition"
          >
            <RefreshCw size={14} />
            Regenerate
          </button>
        </div>
      </div>

      {/* ── TOTP Setup Modal ─────────────────────────────────────────────── */}
      <dialog
        ref={totpDialogRef}
        className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 p-6 max-w-sm w-full backdrop:bg-black/50 shadow-xl"
      >
        <div className="space-y-4">
          <h3 className="text-base font-bold">Set Up Authenticator App</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Scan this QR code with your authenticator app, or manually enter the key below.
          </p>

          {totpSetupData?.uri && (
            <div className="flex justify-center p-3 bg-white rounded-lg border border-neutral-200 shadow-inner">
              <QRCodeSVG value={totpSetupData.uri} size={160} level="M" />
            </div>
          )}

          <div className="space-y-1">
            <span className="text-[11px] text-neutral-400 font-medium">Manual Entry Key:</span>
            <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 font-mono text-xs select-all">
              <span>{totpSetupData?.secret}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(totpSetupData.secret);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                className="text-neutral-500 hover:text-indigo-600"
              >
                {copiedCode ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {totpError && (
            <div role="alert" className="p-2 text-xs rounded bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900">
              {totpError}
            </div>
          )}

          <form onSubmit={confirmTotpEnable} className="space-y-3">
            <div>
              <label htmlFor="confirmCode" className="block text-xs font-medium mb-1">
                Enter 6-digit confirmation code:
              </label>
              <input
                id="confirmCode"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="000000"
                className="w-full text-center tracking-widest font-mono text-base px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => totpDialogRef.current?.close()}
                className="px-3 py-1.5 text-xs font-medium border border-neutral-300 dark:border-neutral-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={totpCode.length !== 6}
                className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg"
              >
                Verify & Activate
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* ── Backup Codes Display Modal ───────────────────────────────────── */}
      <dialog
        ref={backupCodesDialogRef}
        className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 p-6 max-w-sm w-full backdrop:bg-black/50 shadow-xl"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle size={18} />
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Save Your Backup Codes</h3>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            These codes are shown <strong>only once</strong>. Store them in a secure password-protected location or print them out.
          </p>

          <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800/80 font-mono text-xs text-center select-all">
            {generatedBackupCodes?.map((code, idx) => (
              <span key={idx} className="p-1">
                {code}
              </span>
            ))}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                const text = `VaultGuard Emergency Backup Codes\nAccount: ${profile?.email}\n\n` +
                  generatedBackupCodes.join('\n') +
                  `\n\nEach code can be used only once.`;
                const blob = new Blob([text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `vaultguard-backup-codes-${new Date().toISOString().slice(0, 10)}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-neutral-300 dark:border-neutral-700 rounded-lg"
            >
              <Copy size={14} />
              Download .txt
            </button>
            <button
              type="button"
              onClick={() => backupCodesDialogRef.current?.close()}
              className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
            >
              Done
            </button>
          </div>
        </div>
      </dialog>

      {/* ── Passkey Name Modal ───────────────────────────────────────────── */}
      <dialog
        ref={passkeyDialogRef}
        className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 p-6 max-w-sm w-full backdrop:bg-black/50 shadow-xl"
      >
        <form onSubmit={startPasskeyEnrollment} className="space-y-4">
          <h3 className="text-base font-bold">Register Passkey</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Give this passkey a friendly nickname (e.g. "MacBook TouchID", "YubiKey 5").
          </p>
          <div>
            <label htmlFor="passkeyName" className="block text-xs font-medium mb-1">
              Passkey Name
            </label>
            <input
              id="passkeyName"
              type="text"
              required
              value={newPasskeyName}
              onChange={(e) => setNewPasskeyName(e.target.value)}
              placeholder="e.g. My Laptop"
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => passkeyDialogRef.current?.close()}
              className="px-3 py-1.5 text-xs font-medium border border-neutral-300 dark:border-neutral-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
            >
              Continue
            </button>
          </div>
        </form>
      </dialog>

      {/* ── Step-Up Verification Modal ───────────────────────────────────── */}
      <dialog
        ref={stepUpDialogRef}
        className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 p-6 max-w-sm w-full backdrop:bg-black/50 shadow-xl"
      >
        <form onSubmit={handleStepUpSubmit} className="space-y-4">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
            <ShieldCheck size={20} />
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              Security Step-Up Required
            </h3>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            To perform <strong>"{pendingAction?.title}"</strong>, please verify your master password and second factor.
          </p>

          {stepUpError && (
            <div role="alert" className="p-2 text-xs rounded bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900">
              {stepUpError}
            </div>
          )}

          <div>
            <label htmlFor="stepUpPass" className="block text-xs font-medium mb-1">
              Master Password
            </label>
            <input
              id="stepUpPass"
              type="password"
              required
              value={stepUpPassword}
              onChange={(e) => setStepUpPassword(e.target.value)}
              disabled={stepUpLoading}
              placeholder="Your master password"
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {profile?.mfa?.totpEnabled && (
            <div>
              <label htmlFor="stepUpTotp" className="block text-xs font-medium mb-1">
                Authenticator 6-Digit Code
              </label>
              <input
                id="stepUpTotp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={stepUpMfaCode}
                onChange={(e) => setStepUpMfaCode(e.target.value)}
                disabled={stepUpLoading}
                placeholder="000000"
                className="w-full text-center tracking-widest font-mono text-sm px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              disabled={stepUpLoading}
              onClick={() => stepUpDialogRef.current?.close()}
              className="px-3 py-1.5 text-xs font-medium border border-neutral-300 dark:border-neutral-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={stepUpLoading}
              className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition"
            >
              {stepUpLoading ? 'Verifying…' : 'Authorize Action'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
