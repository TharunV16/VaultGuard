import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PasswordField from '../components/PasswordField.jsx';
import { deriveMasterKey, deriveWrapKey, unwrapVaultKey, fromHex } from '../lib/crypto.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Lock, LogOut } from 'lucide-react';

export default function Unlock() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { user, wrappedVaultKey, dispatch, vaultKeyRef, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!user?.kdf?.salt && !wrappedVaultKey) {
        throw new Error('Missing vault key material. Please log in again.');
      }

      const saltBytes = fromHex(user.kdf.salt);
      const masterKey = await deriveMasterKey(password, saltBytes);
      const wrapKey = await deriveWrapKey(masterKey);

      // Unwrap the vault key. AES-GCM will throw if wrong password (auth tag mismatch)
      const vaultKey = await unwrapVaultKey(wrappedVaultKey, wrapKey);

      vaultKeyRef.current = vaultKey;
      dispatch({ type: 'UNLOCKED' });

      toast('Vault unlocked', 'success');
      navigate('/app');
    } catch (err) {
      setError('Incorrect master password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <Lock size={26} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Your Vault is Locked</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Enter your master password for <span className="font-semibold text-neutral-700 dark:text-neutral-300">{user?.email}</span> to decrypt your vault.
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <PasswordField
            id="masterPassword"
            label="Master Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="Enter master password"
            disabled={loading}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
          >
            {loading ? 'Decrypting…' : 'Unlock Vault'}
          </button>
        </form>

        <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 text-center">
          <button
            type="button"
            onClick={() => logout(false)}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            <LogOut size={14} /> Log out or switch account
          </button>
        </div>
      </div>
    </div>
  );
}
