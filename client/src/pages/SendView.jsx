import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fromHex } from '../lib/crypto.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { Shield, Lock, AlertTriangle, Copy, Check, Eye, Loader2 } from 'lucide-react';

/**
 * Decrypt ciphertext from a Secure Send using the key from the URL fragment.
 * The key is NEVER sent to the server; it lives only in window.location.hash (SND-04).
 * @param {string} keyB64url - base64url key from fragment
 * @param {string} ivHex
 * @param {string} ctHex
 * @returns {Promise<string>}
 */
async function decryptSend(keyB64url, ivHex, ctHex) {
  // Restore base64url → standard base64 → raw bytes
  const b64 = keyB64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
  const rawKey = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false, // non-extractable after import on recipient side
    ['decrypt']
  );

  const iv = fromHex(ivHex);
  const ct = fromHex(ctHex);

  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

export default function SendView() {
  const { id } = useParams();
  const [state, setState] = useState('idle'); // idle | loading | success | error | gone
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [viewsUsed, setViewsUsed] = useState(null);
  const [maxViews, setMaxViews] = useState(null);
  const [copied, setCopied] = useState(false);

  // Don't auto-reveal on load — require the user to click "Reveal" (privacy)
  const [revealed, setRevealed] = useState(false);

  const handleReveal = async () => {
    if (state === 'loading') return;

    // Read key from fragment BEFORE making any network request (SND-04)
    const keyB64url = window.location.hash.slice(1);
    if (!keyB64url) {
      setState('error');
      setErrorMsg('The decryption key is missing from the link. Make sure you have the full link including the # part.');
      return;
    }

    setState('loading');

    try {
      // POST — never GET (prevents link prefetch from consuming views, SRS SND-02)
      const res = await fetch(`/api/v1/send/${id}/access`, {
        method: 'POST',
        referrerPolicy: 'no-referrer', // SND-04: fragment must not reach server via Referer
      });

      if (res.status === 410) {
        setState('gone');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Failed to retrieve send');
      }

      const data = await res.json();
      const plaintext = await decryptSend(keyB64url, data.iv, data.ct);

      setMessage(plaintext);
      setViewsUsed(data.viewsUsed);
      setMaxViews(data.maxViews);
      setState('success');
      setRevealed(true);
    } catch (err) {
      setState('error');
      setErrorMsg(err.message || 'Failed to decrypt. The link may be invalid or corrupted.');
    }
  };

  const handleCopy = async () => {
    const res = await copyToClipboard(message, 30);
    if (res.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 mb-3">
            <Lock size={24} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold">Secure Send</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Someone shared an encrypted message with you via VaultGuard.
          </p>
        </div>

        {/* Security explanation */}
        <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-700 dark:text-indigo-300">
          <Shield size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            This message was encrypted in the sender's browser. The decryption key is only in the URL fragment and is never sent to our servers.
          </span>
        </div>

        {/* States */}
        {state === 'idle' && (
          <div className="p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-center space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Clicking "Reveal" will consume one view of this message.
            </p>
            <button
              type="button"
              onClick={handleReveal}
              className="py-2.5 px-8 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition shadow-sm"
            >
              Reveal Message
            </button>
          </div>
        )}

        {state === 'loading' && (
          <div className="p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-center">
            <Loader2 size={24} className="animate-spin mx-auto text-indigo-500 mb-2" />
            <p className="text-sm text-neutral-500">Decrypting…</p>
          </div>
        )}

        {state === 'success' && revealed && (
          <div className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-neutral-900 space-y-3">
            {viewsUsed !== null && maxViews !== null && (
              <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                <Eye size={12} />
                View {viewsUsed} of {maxViews}
              </div>
            )}
            <pre className="text-sm font-mono whitespace-pre-wrap break-all bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 select-all">
              {message}
            </pre>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy decrypted message"
                className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              >
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                {copied ? 'Copied (clears in 30s)' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {state === 'gone' && (
          <div className="p-6 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-center space-y-2">
            <AlertTriangle size={24} className="mx-auto text-amber-600 dark:text-amber-400 mb-1" />
            <p className="font-semibold text-amber-800 dark:text-amber-200">This send has expired or reached its view limit.</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              The sender may need to create a new send.
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="p-6 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-center space-y-2" role="alert">
            <AlertTriangle size={24} className="mx-auto text-rose-600 dark:text-rose-400 mb-1" />
            <p className="font-semibold text-rose-800 dark:text-rose-200">Failed to decrypt</p>
            <p className="text-xs text-rose-700 dark:text-rose-300">{errorMsg}</p>
          </div>
        )}

        <p className="text-center text-xs text-neutral-400">
          Powered by <strong>VaultGuard</strong> — zero-knowledge encryption
        </p>
      </div>
    </div>
  );
}
