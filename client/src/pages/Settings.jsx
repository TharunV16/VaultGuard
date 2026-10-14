import { useState, useEffect, useRef, useCallback } from 'react';
import MfaSetup from '../components/MfaSetup.jsx';
import PasswordField from '../components/PasswordField.jsx';
import StrengthMeter from '../components/StrengthMeter.jsx';
import {
  ShieldCheck,
  User,
  KeyRound,
  Download,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Laptop,
  Smartphone,
  Globe,
  Trash2,
  Lock,
  Moon,
  Sun,
  Sliders,
  FileSpreadsheet,
  FileJson,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useVault } from '../context/VaultContext.jsx';
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
  deriveWrapKey,
  fromHex,
  toHex,
} from '../lib/crypto.js';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('preferences');
  const { user, accessToken, vaultKeyRef, dispatch, logout } = useAuth();
  const { items } = useVault();
  const { toast } = useToast();

  // ───────────────────────────────────────────────────────────────────────────
  // Tab 1: General Preferences (SET-01)
  // ───────────────────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState({
    autoLockMinutes: user?.settings?.autoLockMinutes ?? 5,
    clipboardSeconds: user?.settings?.clipboardSeconds ?? 30,
    theme: user?.settings?.theme ?? 'system',
    breachAutoScan: user?.settings?.breachAutoScan ?? true,
    snapshotsOptIn: user?.settings?.snapshotsOptIn ?? false,
    generatorDefaults: user?.settings?.generatorDefaults ?? {
      length: 20,
      lowercase: true,
      uppercase: true,
      digits: true,
      symbols: true,
    },
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const handleSettingChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleGeneratorChange = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      generatorDefaults: {
        ...(prev.generatorDefaults || {}),
        [key]: value,
      },
    }));
  };

  const savePreferences = async (e) => {
    if (e) e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await api('/api/v1/me/settings', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: settings,
      });

      // Update theme in DOM
      const themeVal = settings.theme;
      if (themeVal === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', themeVal);
      }
      localStorage.setItem('vg-theme', themeVal);

      // Also persist generator defaults locally (GEN-05)
      localStorage.setItem('vg-gen-opts', JSON.stringify(settings.generatorDefaults));

      dispatch({
        type: 'USER_UPDATED',
        user: { ...user, settings: res.settings },
      });
      toast('Preferences saved successfully', 'success');
    } catch (err) {
      toast(err.message || 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Tab 2: Security & Master Password Change (AUTH-15)
  // ───────────────────────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const changePasswordDialogRef = useRef(null);

  const handleChangePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordChangeError('');

    if (newPassword !== confirmPassword) {
      setPasswordChangeError('New passwords do not match');
      return;
    }
    if (newPassword.length < 12) {
      setPasswordChangeError('Master password must be at least 12 characters');
      return;
    }
    if (!vaultKeyRef.current) {
      setPasswordChangeError('Vault is locked. Please unlock first.');
      return;
    }

    setPasswordChangeLoading(true);
    try {
      // 1. Step-up auth with current master password
      const pre = await api('/api/v1/auth/prelogin', {
        method: 'POST',
        body: { email: user.email },
      });

      const oldSalt = fromHex(pre.kdf.salt);
      const oldMasterKey = await deriveMasterKey(currentPassword, oldSalt);
      const oldAuthKey = await deriveAuthKey(oldMasterKey);

      const stepUpRes = await api('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { authKey: oldAuthKey },
      });
      const stepUpToken = stepUpRes.stepUpToken;

      // 2. Derive new keys with fresh 16-byte random salt
      const newSaltBytes = crypto.getRandomValues(new Uint8Array(16));
      const newMasterKey = await deriveMasterKey(newPassword, newSaltBytes);
      const newAuthKey = await deriveAuthKey(newMasterKey);
      const newWrapKey = await deriveWrapKey(newMasterKey);

      // 3. Re-wrap the existing vaultKey (zero re-encryption of items)
      const newWrappedVaultKey = await wrapVaultKey(vaultKeyRef.current, newWrapKey);

      // 4. Update password on server
      await api('/api/v1/me/password', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-step-up-token': stepUpToken,
        },
        body: {
          authKey: newAuthKey,
          kdf: {
            algo: 'PBKDF2-SHA256',
            iterations: 600000,
            salt: toHex(newSaltBytes),
          },
          wrappedVaultKey: newWrappedVaultKey,
        },
      });

      changePasswordDialogRef.current?.close();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Master password changed. All other sessions revoked.', 'success');
    } catch (err) {
      setPasswordChangeError(err.message || 'Failed to change master password');
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Tab 3: Recovery Key Rotation (REC-07)
  // ───────────────────────────────────────────────────────────────────────────
  const [rotateLoading, setRotateLoading] = useState(false);
  const [rotateError, setRotateError] = useState('');
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [newRotatedKey, setNewRotatedKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const stepUpDialogRef = useRef(null);
  const keyModalRef = useRef(null);

  const handleRotateSubmit = async (e) => {
    e.preventDefault();
    setRotateError('');
    setRotateLoading(true);

    try {
      if (!vaultKeyRef.current) {
        throw new Error('Vault is locked. Please unlock your vault first.');
      }

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

      const newRecBytes = generateRecoveryKeyBytes();
      const newRecString = encodeRecoveryKey(newRecBytes);
      const newRecWrapKey = await deriveRecoveryWrapKey(newRecBytes);
      const newRecoveryWrappedVaultKey = await wrapVaultKey(vaultKeyRef.current, newRecWrapKey);
      const newRecoveryVerifier = await deriveRecoveryVerifier(newRecBytes);

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
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 3000);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Tab 4: Active Sessions (SES-01)
  // ───────────────────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState(null);
  const revokeAllDialogRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    if (!accessToken) return;
    setSessionsLoading(true);
    try {
      const res = await api('/api/v1/me/sessions', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setSessions(res.sessions || []);
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (activeTab === 'sessions') {
      fetchSessions();
    }
  }, [activeTab, fetchSessions]);

  const handleRevokeSession = async (id) => {
    setRevokingSessionId(id);
    try {
      await api(`/api/v1/me/sessions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast('Session revoked', 'success');
    } catch (err) {
      toast(err.message || 'Failed to revoke session', 'error');
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleRevokeAllOtherSessions = async () => {
    try {
      const res = await api('/api/v1/me/sessions', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      revokeAllDialogRef.current?.close();
      toast(`Revoked ${res.revokedCount} other session(s)`, 'success');
      fetchSessions();
    } catch (err) {
      toast(err.message || 'Failed to revoke sessions', 'error');
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Tab 5: Vault Export (VLT-13)
  // ───────────────────────────────────────────────────────────────────────────
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportStepUpPassword, setExportStepUpPassword] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportPlaintextDialogRef = useRef(null);

  const handleExportEncryptedJson = async (e) => {
    e.preventDefault();
    if (!exportPassphrase || exportPassphrase.length < 8) {
      toast('Please enter an export passphrase (at least 8 characters)', 'error');
      return;
    }

    setExportLoading(true);
    try {
      const activeList = Array.from(items.values())
        .filter((i) => !i.deletedAt)
        .map((i) => ({
          id: i._id,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
          folderId: i.folderId,
          ...(i.data || {}),
        }));

      // Derive key via PBKDF2 (100,000 iterations for export)
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const enc = new TextEncoder();
      const baseKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(exportPassphrase),
        'PBKDF2',
        false,
        ['deriveKey']
      );
      const aesKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = enc.encode(JSON.stringify({ version: '1.0', exportedAt: new Date().toISOString(), items: activeList }));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);

      const exportPayload = {
        vaultguard: 'encrypted_export',
        version: '1.0',
        kdf: { algo: 'PBKDF2-SHA256', iterations: 100000, salt: toHex(salt) },
        encryption: { algo: 'AES-256-GCM', iv: toHex(iv) },
        ciphertext: toHex(new Uint8Array(ciphertext)),
      };

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vaultguard-encrypted-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      // Audit log
      await api('/api/v1/vault/export-audit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { format: 'encrypted_json', itemCount: activeList.length },
      });

      setExportPassphrase('');
      toast(`Exported ${activeList.length} items securely`, 'success');
    } catch (err) {
      toast(err.message || 'Export failed', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportPlaintextCsv = async (e) => {
    e.preventDefault();
    setExportError('');
    setExportLoading(true);

    try {
      // Step-up auth
      const pre = await api('/api/v1/auth/prelogin', {
        method: 'POST',
        body: { email: user.email },
      });

      const saltBytes = fromHex(pre.kdf.salt);
      const masterKey = await deriveMasterKey(exportStepUpPassword, saltBytes);
      const authKey = await deriveAuthKey(masterKey);

      await api('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { authKey },
      });

      const activeList = Array.from(items.values()).filter((i) => !i.deletedAt);

      // Build CSV
      const headers = ['type', 'name', 'username', 'password', 'uri', 'notes', 'totp'];
      const escapeCsv = (str) => {
        if (!str) return '""';
        return `"${String(str).replace(/"/g, '""')}"`;
      };

      const rows = activeList.map((i) => {
        const d = i.data || {};
        return [
          escapeCsv(d.type),
          escapeCsv(d.name),
          escapeCsv(d.username),
          escapeCsv(d.password),
          escapeCsv(d.uris ? d.uris.join(';') : d.uri),
          escapeCsv(d.notes),
          escapeCsv(d.totp),
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vaultguard-plaintext-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      // Audit log & server email alert
      await api('/api/v1/vault/export-audit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { format: 'plaintext_csv', itemCount: activeList.length },
      });

      exportPlaintextDialogRef.current?.close();
      setExportStepUpPassword('');
      toast(`Exported ${activeList.length} items as CSV`, 'success');
    } catch (err) {
      setExportError(err.message || 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Tab 6: Danger Zone / Account Deletion (AUTH-18)
  // ───────────────────────────────────────────────────────────────────────────
  const [deleteStepUpPassword, setDeleteStepUpPassword] = useState('');
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteAccountDialogRef = useRef(null);

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    setDeleteError('');

    if (deleteConfirmationText !== 'DELETE MY ACCOUNT') {
      setDeleteError('Please type DELETE MY ACCOUNT exactly as shown');
      return;
    }

    setDeleteLoading(true);
    try {
      const pre = await api('/api/v1/auth/prelogin', {
        method: 'POST',
        body: { email: user.email },
      });

      const saltBytes = fromHex(pre.kdf.salt);
      const masterKey = await deriveMasterKey(deleteStepUpPassword, saltBytes);
      const authKey = await deriveAuthKey(masterKey);

      const stepUpRes = await api('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { authKey },
      });
      const stepUpToken = stepUpRes.stepUpToken;

      await api('/api/v1/me', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-step-up-token': stepUpToken,
        },
        body: { confirmation: 'DELETE MY ACCOUNT' },
      });

      deleteAccountDialogRef.current?.close();
      toast('Your account and vault have been permanently deleted', 'info');
      logout();
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete account');
    } finally {
      setDeleteLoading(false);
    }
  };

  const expectedLastGroup = newRotatedKey.split(' ').pop() || '';
  const isConfirmed = typedConfirmation.trim().toUpperCase() === expectedLastGroup.toUpperCase();

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account & Security Settings</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Customize your vault behavior, manage active sessions, multi-factor authentication, and exports.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 text-xs overflow-x-auto">
        {[
          { id: 'preferences', label: 'Preferences', icon: Sliders },
          { id: 'security', label: 'Security & MFA', icon: ShieldCheck },
          { id: 'sessions', label: 'Active Sessions', icon: Laptop },
          { id: 'export', label: 'Vault Export', icon: Download },
          { id: 'recovery', label: 'Recovery Key', icon: KeyRound },
          { id: 'account', label: 'Account / Danger Zone', icon: User },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 py-2.5 px-3.5 font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === t.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Tab: Preferences */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'preferences' && (
        <form onSubmit={savePreferences} className="space-y-6">
          <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-5">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sliders size={18} className="text-indigo-600 dark:text-indigo-400" />
              Vault Security & Lock
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Auto-lock Timeout */}
              <div className="space-y-1.5">
                <label htmlFor="autoLockSelect" className="font-medium text-neutral-700 dark:text-neutral-300">
                  Auto-Lock Inactivity Timeout
                </label>
                <select
                  id="autoLockSelect"
                  value={settings.autoLockMinutes}
                  onChange={(e) => handleSettingChange('autoLockMinutes', Number(e.target.value))}
                  className="w-full p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                >
                  <option value={1}>1 minute</option>
                  <option value={5}>5 minutes (recommended)</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
                <p className="text-[11px] text-neutral-500">Locks your vault automatically when inactive or tab is closed.</p>
              </div>

              {/* Clipboard Auto-Clear */}
              <div className="space-y-1.5">
                <label htmlFor="clipboardSelect" className="font-medium text-neutral-700 dark:text-neutral-300">
                  Clipboard Auto-Clear Timeout
                </label>
                <select
                  id="clipboardSelect"
                  value={settings.clipboardSeconds}
                  onChange={(e) => handleSettingChange('clipboardSeconds', Number(e.target.value))}
                  className="w-full p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                >
                  <option value={10}>10 seconds</option>
                  <option value={30}>30 seconds (standard)</option>
                  <option value={60}>60 seconds</option>
                  <option value={120}>120 seconds (2 minutes)</option>
                </select>
                <p className="text-[11px] text-neutral-500">Overwrites copied credentials from clipboard memory after this duration.</p>
              </div>

              {/* Theme */}
              <div className="space-y-1.5">
                <label htmlFor="themeSelect" className="font-medium text-neutral-700 dark:text-neutral-300">
                  Color Appearance
                </label>
                <select
                  id="themeSelect"
                  value={settings.theme}
                  onChange={(e) => handleSettingChange('theme', e.target.value)}
                  className="w-full p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                >
                  <option value="system">System Default</option>
                  <option value="dark">Dark Mode</option>
                  <option value="light">Light Mode</option>
                </select>
              </div>
            </div>

            <hr className="border-neutral-200 dark:border-neutral-800" />

            {/* Checkbox Toggles */}
            <div className="space-y-3 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.breachAutoScan}
                  onChange={(e) => handleSettingChange('breachAutoScan', e.target.checked)}
                  className="mt-0.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">Automated Breach Monitoring (HIBP)</span>
                  <p className="text-[11px] text-neutral-500">Periodically checks k-anonymity breach status of stored passwords upon unlock (at most once every 24h).</p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.snapshotsOptIn}
                  onChange={(e) => handleSettingChange('snapshotsOptIn', e.target.checked)}
                  className="mt-0.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">Daily Security Score History Snapshots</span>
                  <p className="text-[11px] text-neutral-500">Enables historical trend graphs on your dashboard. Saves only numerical score counts, never passwords.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Generator Defaults */}
          <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4 text-xs">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <KeyRound size={18} className="text-indigo-600 dark:text-indigo-400" />
              Password Generator Defaults
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="genLengthInput" className="font-medium text-neutral-700 dark:text-neutral-300">
                  Default Length: {settings.generatorDefaults?.length || 20} characters
                </label>
                <input
                  id="genLengthInput"
                  type="range"
                  min="8"
                  max="64"
                  value={settings.generatorDefaults?.length || 20}
                  onChange={(e) => handleGeneratorChange('length', Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <div className="space-y-2">
                <span className="font-medium text-neutral-700 dark:text-neutral-300 block">Character Sets:</span>
                <div className="flex flex-wrap gap-4">
                  {['uppercase', 'lowercase', 'digits', 'symbols'].map((key) => (
                    <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(settings.generatorDefaults?.[key])}
                        onChange={(e) => handleGeneratorChange(key, e.target.checked)}
                        className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="capitalize">{key}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition"
            >
              {savingSettings ? 'Saving…' : 'Save Preferences'}
            </button>
          </div>
        </form>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Tab: Security & Master Password */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* Master Password Change Section */}
          <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Lock size={18} className="text-indigo-600 dark:text-indigo-400" />
                  Master Password
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-xl">
                  Changing your master password generates a new authentication key and re-encrypts your vault key.
                  Existing vault items are not re-encrypted. All other active sessions will be terminated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPasswordChangeError('');
                  changePasswordDialogRef.current?.showModal();
                }}
                className="py-1.5 px-3 text-xs font-medium rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 transition"
              >
                Change Password
              </button>
            </div>
          </div>

          {/* MFA Setup Component */}
          <MfaSetup />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Tab: Active Sessions (SES-01) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'sessions' && (
        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Laptop size={18} className="text-indigo-600 dark:text-indigo-400" />
                Active Sessions
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                These devices are currently authenticated to your VaultGuard account.
              </p>
            </div>
            {sessions.filter((s) => !s.isCurrent).length > 0 && (
              <button
                type="button"
                onClick={() => revokeAllDialogRef.current?.showModal()}
                className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
              >
                Revoke All Other Sessions
              </button>
            )}
          </div>

          {sessionsLoading ? (
            <div className="py-8 text-center text-xs text-neutral-400 animate-pulse">
              Loading active sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-400">No active sessions found.</div>
          ) : (
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
              {sessions.map((s) => {
                const label = s.device?.label || 'Unknown Browser';
                const isMobile = label.includes('iOS') || label.includes('Android');
                const Icon = isMobile ? Smartphone : Laptop;

                return (
                  <div key={s.id} className="p-3.5 flex items-center justify-between text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{label}</span>
                          {s.isCurrent && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                              This Device
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          IP: <span className="font-mono">{s.device?.ipPrefix || 'unknown'}</span> • Last active:{' '}
                          {new Date(s.lastUsedAt || s.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>

                    {!s.isCurrent && (
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(s.id)}
                        disabled={revokingSessionId === s.id}
                        className="p-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                        title="Revoke session"
                        aria-label={`Revoke session for ${label}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Tab: Vault Export (VLT-13) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          {/* Encrypted JSON (Recommended) */}
          <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <FileJson size={22} />
              </div>
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Encrypted JSON Export</h2>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Encrypts all vault items using a custom passphrase with PBKDF2 (100,000 iterations) and AES-256-GCM.
                  Safe to store in cloud backups or external drives.
                </p>
              </div>
            </div>

            <form onSubmit={handleExportEncryptedJson} className="pt-2 flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <input
                  type="password"
                  value={exportPassphrase}
                  onChange={(e) => setExportPassphrase(e.target.value)}
                  placeholder="Enter a strong export passphrase"
                  required
                  className="w-full text-xs p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                />
              </div>
              <button
                type="submit"
                disabled={exportLoading}
                className="inline-flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition shrink-0"
              >
                <Download size={14} />
                Export Encrypted JSON
              </button>
            </form>
          </div>

          {/* Plaintext CSV (Requires Step-Up & Warning) */}
          <div className="p-5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/20 space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                <FileSpreadsheet size={22} />
              </div>
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Plaintext CSV Export</h2>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                    High Risk
                  </span>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  Exports your credentials in unencrypted plaintext CSV format compatible with standard password managers and spreadsheets.
                  Requires master password step-up confirmation.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setExportError('');
                  exportPlaintextDialogRef.current?.showModal();
                }}
                className="inline-flex items-center gap-1.5 py-2 px-4 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-neutral-900 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-300 transition"
              >
                <AlertTriangle size={14} />
                Export Plaintext CSV…
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Tab: Recovery Key (REC-07) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'recovery' && (
        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <KeyRound size={20} className="text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-sm font-semibold">160-bit Emergency Recovery Key</h2>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-xl">
                Your recovery key allows you to restore access to your encrypted vault if you forget your master password.
                If you suspect your recovery key has been seen or compromised, you can rotate it now.
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
              onClick={() => {
                setStepUpPassword('');
                setRotateError('');
                stepUpDialogRef.current?.showModal();
              }}
              className="inline-flex items-center gap-1.5 py-2 px-3.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition"
            >
              <RefreshCw size={14} />
              Rotate Recovery Key
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Tab: Account & Danger Zone (AUTH-18) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3">
            <h2 className="text-sm font-semibold">Account Profile</h2>
            <div className="text-xs space-y-1.5 text-neutral-600 dark:text-neutral-400">
              <p><strong className="text-neutral-800 dark:text-neutral-200">Email:</strong> {user?.email}</p>
              <p><strong className="text-neutral-800 dark:text-neutral-200">Role:</strong> {user?.role}</p>
              <p><strong className="text-neutral-800 dark:text-neutral-200">Email Status:</strong> {user?.emailVerified ? 'Verified' : 'Unverified'}</p>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="p-5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/20 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                <ShieldAlert size={18} />
                Danger Zone
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Permanently delete your VaultGuard account and all associated encrypted vault credentials, folders, sends, and history.
                This operation is irreversible.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setDeleteError('');
                setDeleteConfirmationText('');
                setDeleteStepUpPassword('');
                deleteAccountDialogRef.current?.showModal();
              }}
              className="py-2 px-4 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition"
            >
              Delete Account…
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* DIALOGS */}
      {/* ─────────────────────────────────────────────────────────────────── */}

      {/* Change Password Dialog */}
      <dialog
        ref={changePasswordDialogRef}
        className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 backdrop:bg-black/50 shadow-2xl max-w-md w-full"
      >
        <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="text-indigo-600" size={20} />
            <h3 className="text-sm font-semibold">Change Master Password</h3>
          </div>

          <p className="text-xs text-neutral-500">
            Confirm your current master password and enter a new one. Your vault key will be re-encrypted and all other active sessions will be terminated.
          </p>

          {passwordChangeError && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-600 border border-rose-200 dark:border-rose-900" role="alert">
              {passwordChangeError}
            </div>
          )}

          <div className="space-y-3">
            <PasswordField
              id="currentMasterPw"
              label="Current Master Password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={passwordChangeLoading}
              placeholder="Enter current password"
            />

            <div className="space-y-1">
              <PasswordField
                id="newMasterPw"
                label="New Master Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={passwordChangeLoading}
                placeholder="At least 12 characters"
              />
              <StrengthMeter password={newPassword} userInputs={[user?.email || '']} />
            </div>

            <PasswordField
              id="confirmNewMasterPw"
              label="Confirm New Master Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={passwordChangeLoading}
              placeholder="Re-enter new password"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => changePasswordDialogRef.current?.close()}
              disabled={passwordChangeLoading}
              className="py-1.5 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={passwordChangeLoading}
              className="py-1.5 px-3 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
            >
              {passwordChangeLoading ? 'Re-encrypting…' : 'Update Password'}
            </button>
          </div>
        </form>
      </dialog>

      {/* Revoke All Other Sessions Confirmation Dialog */}
      <dialog
        ref={revokeAllDialogRef}
        className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 backdrop:bg-black/50 shadow-2xl max-w-sm w-full"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-amber-500" size={20} />
            <h3 className="text-sm font-semibold">Revoke All Other Sessions?</h3>
          </div>
          <p className="text-xs text-neutral-500">
            This will immediately log you out of all devices and browsers except this current one.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => revokeAllDialogRef.current?.close()}
              className="py-1.5 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRevokeAllOtherSessions}
              className="py-1.5 px-3 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
            >
              Revoke Sessions
            </button>
          </div>
        </div>
      </dialog>

      {/* Export Plaintext CSV Dialog */}
      <dialog
        ref={exportPlaintextDialogRef}
        className="p-6 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 backdrop:bg-black/50 shadow-2xl max-w-md w-full"
      >
        <form onSubmit={handleExportPlaintextCsv} className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-amber-500" size={22} />
            <h3 className="text-sm font-semibold">Warning: Plaintext Export</h3>
          </div>

          <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
            Exporting as plaintext will save all your passwords, usernames, and notes unencrypted on this computer. Anyone with access to the downloaded file can read your secrets.
          </p>

          {exportError && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-600 border border-rose-200 dark:border-rose-900" role="alert">
              {exportError}
            </div>
          )}

          <PasswordField
            id="exportStepUpPw"
            label="Confirm Master Password"
            value={exportStepUpPassword}
            onChange={(e) => setExportStepUpPassword(e.target.value)}
            required
            disabled={exportLoading}
            placeholder="Enter your master password"
          />

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => exportPlaintextDialogRef.current?.close()}
              disabled={exportLoading}
              className="py-1.5 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={exportLoading}
              className="py-1.5 px-3 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
            >
              {exportLoading ? 'Exporting…' : 'I Understand, Export CSV'}
            </button>
          </div>
        </form>
      </dialog>

      {/* Rotate Recovery Key Step-Up Dialog */}
      <dialog
        ref={stepUpDialogRef}
        className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 backdrop:bg-black/40 shadow-xl max-w-md w-full"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-amber-500" size={20} />
            <h3 className="text-sm font-semibold">Confirm Master Password</h3>
          </div>
          <p className="text-xs text-neutral-500">
            Rotating your recovery key invalidates your old key immediately. Re-enter your master password to proceed.
          </p>

          {rotateError && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-600 border border-rose-200 dark:border-rose-900" role="alert">
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
                className="py-1.5 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={rotateLoading}
                className="py-1.5 px-3 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {rotateLoading ? 'Rotating…' : 'Generate New Key'}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* Rotated Key Display Dialog */}
      <dialog
        ref={keyModalRef}
        className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 backdrop:bg-black/40 shadow-xl max-w-md w-full"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <Check size={20} />
            <h3 className="text-sm font-semibold">New Recovery Key Generated</h3>
          </div>

          <div className="p-3 bg-neutral-100 dark:bg-neutral-800 rounded-lg font-mono text-center text-xs tracking-wider font-semibold select-all">
            {newRotatedKey}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={downloadNewKey}
              className="flex-1 py-1.5 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center justify-center gap-1.5"
            >
              <Download size={14} />
              Download .txt
            </button>
            <button
              type="button"
              onClick={copyNewKey}
              className="flex-1 py-1.5 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center justify-center gap-1.5"
            >
              {copiedKey ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              {copiedKey ? 'Copied!' : 'Copy Key'}
            </button>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <label htmlFor="confirmGroupInput" className="text-xs font-medium">
              Confirm last group (<span className="font-mono">{expectedLastGroup}</span>):
            </label>
            <input
              id="confirmGroupInput"
              type="text"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              placeholder="Type the last group here"
              className="w-full p-2 text-xs font-mono rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={!isConfirmed}
              onClick={() => keyModalRef.current?.close()}
              className="py-1.5 px-4 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40"
            >
              Done
            </button>
          </div>
        </div>
      </dialog>

      {/* Delete Account Dialog */}
      <dialog
        ref={deleteAccountDialogRef}
        className="p-6 rounded-xl border border-rose-300 dark:border-rose-900 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 backdrop:bg-black/50 shadow-2xl max-w-md w-full"
      >
        <form onSubmit={handleDeleteAccount} className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-rose-600" size={22} />
            <h3 className="text-sm font-semibold text-rose-600">Delete Account & All Vault Data</h3>
          </div>

          <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
            This action is permanent and cannot be undone. All your encrypted vault items, folders, and settings will be permanently wiped.
          </p>

          {deleteError && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-600 border border-rose-200 dark:border-rose-900" role="alert">
              {deleteError}
            </div>
          )}

          <PasswordField
            id="deleteStepUpPw"
            label="Master Password"
            value={deleteStepUpPassword}
            onChange={(e) => setDeleteStepUpPassword(e.target.value)}
            required
            disabled={deleteLoading}
            placeholder="Enter your master password"
          />

          <div className="space-y-1">
            <label htmlFor="deleteConfirmText" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Type <strong className="font-mono text-rose-600">DELETE MY ACCOUNT</strong> to confirm:
            </label>
            <input
              id="deleteConfirmText"
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              required
              disabled={deleteLoading}
              placeholder="DELETE MY ACCOUNT"
              className="w-full text-xs p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => deleteAccountDialogRef.current?.close()}
              disabled={deleteLoading}
              className="py-1.5 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleteLoading || deleteConfirmationText !== 'DELETE MY ACCOUNT'}
              className="py-1.5 px-3 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-40"
            >
              {deleteLoading ? 'Deleting…' : 'Permanently Delete Account'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
