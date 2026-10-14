import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { toHex, fromHex } from '../lib/crypto.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  Lock,
  Plus,
  Trash2,
  Copy,
  Check,
  Eye,
  Clock,
  Shield,
  Loader2,
  ChevronDown,
} from 'lucide-react';

const EXPIRY_OPTIONS = [
  { value: '1h',  label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days (max)' },
];

/**
 * Encrypt text with a fresh random AES-256-GCM key.
 * Key is NOT sent to server — only stored in URL fragment (SND-04).
 * @param {string} text
 * @returns {Promise<{ iv: string, ct: string, keyB64: string }>}
 */
async function encryptSend(text) {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can put it in the fragment
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  );
  // Export key as raw bytes → base64url for URL fragment
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const keyB64 = btoa(String.fromCharCode(...rawKey))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return { iv: toHex(iv), ct: toHex(new Uint8Array(ct)), keyB64 };
}

function SendCard({ send, onRevoke }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const link = `${window.location.origin}/s/${send._id}#${send._keyB64}`;

  const handleCopy = async () => {
    const res = await copyToClipboard(link, 30);
    if (res.success) {
      setCopied(true);
      toast('Link copied — clears in 30 seconds', 'info');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const expiresAt = new Date(send.expiresAt);
  const expired = expiresAt < new Date();

  return (
    <div className={`p-4 rounded-xl border ${expired ? 'border-neutral-200 dark:border-neutral-800 opacity-60' : 'border-indigo-200 dark:border-indigo-800'} bg-white dark:bg-neutral-900`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Lock size={13} className="text-indigo-500" />
            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              {expired ? 'Expired' : 'Active'}
            </span>
            <span className="text-xs text-neutral-400">·</span>
            <span className="text-xs text-neutral-500 flex items-center gap-1">
              <Eye size={11} /> {send.views} / {send.maxViews} views
            </span>
            <span className="text-xs text-neutral-400">·</span>
            <span className="text-xs text-neutral-500 flex items-center gap-1">
              <Clock size={11} /> {expired ? 'Expired' : `Expires ${expiresAt.toLocaleDateString()}`}
            </span>
          </div>
          {!expired && send._keyB64 && (
            <p className="text-xs text-neutral-400 font-mono truncate">{link.slice(0, 60)}…</p>
          )}
          {!send._keyB64 && (
            <p className="text-xs text-neutral-500 italic">Link not available (key not stored on server)</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!expired && send._keyB64 && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy send link"
              className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => onRevoke(send._id)}
            aria-label="Revoke send"
            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Send() {
  const { accessToken } = useAuth();
  const { toast } = useToast();

  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [text, setText] = useState('');
  const [maxViews, setMaxViews] = useState(1);
  const [expiresIn, setExpiresIn] = useState('24h');
  const [newLink, setNewLink] = useState('');

  const fetchSends = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await api('/api/v1/send', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setSends(data.sends || []);
    } catch {
      // ignore — show empty state
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchSends(); }, [fetchSends]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setCreating(true);
    setNewLink('');
    try {
      const { iv, ct, keyB64 } = await encryptSend(text.trim());
      const data = await api('/api/v1/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { iv, ct, maxViews, expiresIn },
      });

      const link = `${window.location.origin}/s/${data.send._id}#${keyB64}`;
      setNewLink(link);
      // Store keyB64 locally for this session so we can show the link in the list
      setSends((prev) => [{ ...data.send, _keyB64: keyB64 }, ...prev]);
      setText('');
    } catch (err) {
      toast(err.message || 'Failed to create send', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id) => {
    const dialog = document.getElementById('confirm-revoke-dialog');
    dialog?.showModal?.();
    if (!window.confirm('Revoke this send? Recipients will no longer be able to access it.')) return;
    try {
      await api(`/api/v1/send/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setSends((prev) => prev.filter((s) => s._id !== id));
      toast('Send revoked', 'success');
    } catch (err) {
      toast(err.message || 'Failed to revoke', 'error');
    }
  };

  const handleCopyNewLink = async () => {
    if (!newLink) return;
    await copyToClipboard(newLink, 30);
    toast('Link copied — clears in 30 seconds', 'info');
  };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Secure Send</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          Share encrypted text with a self-destructing link. The key is only in the link fragment — never sent to our servers.
        </p>
      </div>

      {/* Security note */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-700 dark:text-indigo-300">
        <Shield size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Your message is encrypted in the browser with a unique AES-256-GCM key. Only people with the full link (including the <code>#key</code> fragment) can decrypt it.
        </span>
      </div>

      {/* Create form toggle */}
      <button
        type="button"
        onClick={() => setShowForm((f) => !f)}
        className="inline-flex items-center gap-2 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition shadow-sm"
      >
        <Plus size={15} /> New Send
        <ChevronDown size={13} className={`transition-transform ${showForm ? 'rotate-180' : ''}`} />
      </button>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold mb-1.5" htmlFor="send-text">
              Message or secret to share
            </label>
            <textarea
              id="send-text"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste a password, API key, or any secret text…"
              maxLength={100_000}
              className="w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              aria-required="true"
            />
            <p className="text-xs text-neutral-400 mt-1">{text.length.toLocaleString()} / 100,000 chars</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" htmlFor="send-max-views">
                Max views (1–20)
              </label>
              <input
                id="send-max-views"
                type="number"
                min={1}
                max={20}
                value={maxViews}
                onChange={(e) => setMaxViews(Math.max(1, Math.min(20, Number(e.target.value))))}
                className="w-full px-3 py-1.5 text-sm border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" htmlFor="send-expires-in">
                Expires in
              </label>
              <select
                id="send-expires-in"
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-950"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={creating || !text.trim()}
            className="inline-flex items-center gap-2 py-2 px-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            {creating ? 'Encrypting…' : 'Create Send'}
          </button>
        </form>
      )}

      {/* New link banner */}
      {newLink && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ Send created. Copy this link now — you won't be able to retrieve it later.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono break-all text-neutral-700 dark:text-neutral-300">{newLink}</code>
            <button
              type="button"
              onClick={handleCopyNewLink}
              aria-label="Copy send link"
              className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Sends list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Your Sends</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : sends.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            <Lock size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No sends yet. Create one above.</p>
          </div>
        ) : (
          sends.map((send) => (
            <SendCard key={send._id} send={send} onRevoke={handleRevoke} />
          ))
        )}
      </div>
    </div>
  );
}
