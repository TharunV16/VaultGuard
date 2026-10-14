import { useState, useMemo, useCallback, useRef } from 'react';
import { useVault } from '../context/VaultContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { calculateSecurityScore } from '../lib/score.js';
import { checkBreachBulk } from '../lib/hibp.js';
import { generatePassword } from '../lib/generator.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useToast } from '../context/ToastContext.jsx';
import StrengthMeter from '../components/StrengthMeter.jsx';
import {
  ShieldAlert,
  ShieldX,
  RefreshCw,
  AlertTriangle,
  Key,
  Wand2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';

const ISSUE_META = {
  masterEqual: { icon: ShieldX, label: 'Matches Master Password', color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-200 dark:border-rose-800' },
  breached:    { icon: ShieldX, label: 'Found in data breach',     color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-200 dark:border-rose-800' },
  reused:      { icon: RefreshCw, label: 'Reused password',        color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800' },
  weak:        { icon: AlertTriangle, label: 'Weak password',      color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800' },
  similar:     { icon: Key, label: 'Similar variation',            color: 'text-neutral-600 dark:text-neutral-400', bg: 'bg-neutral-50 dark:bg-neutral-900', border: 'border-neutral-200 dark:border-neutral-800' },
  old:         { icon: RefreshCw, label: 'Password not changed in 180+ days', color: 'text-neutral-600 dark:text-neutral-400', bg: 'bg-neutral-50 dark:bg-neutral-900', border: 'border-neutral-200 dark:border-neutral-800' },
};

const BADGE_SEVERITY = ['masterEqual', 'breached', 'reused', 'weak', 'similar', 'old'];

function IssueBadge({ type }) {
  const meta = ISSUE_META[type];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color} ${meta.bg} ${meta.border}`}>
      <Icon size={11} /> {meta.label}
    </span>
  );
}

function FlaggedItemRow({ entry, onFix, onCopy }) {
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [copied, setCopied] = useState(false);

  const topIssue = entry.issues.reduce((top, iss) =>
    (iss.penalty > (top?.penalty ?? 0) ? iss : top), null);

  const meta = topIssue ? ISSUE_META[topIssue.type] : null;
  const Icon = meta?.icon ?? ShieldAlert;

  const handleFix = () => {
    const pwd = generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true });
    setSuggestion(pwd);
    setOpen(true);
  };

  const handleCopySuggestion = async () => {
    const res = await copyToClipboard(suggestion, 30);
    if (res.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy?.('Copied suggested password — clears in 30 seconds');
    }
  };

  return (
    <div className={`rounded-xl border ${meta?.border ?? 'border-neutral-200 dark:border-neutral-800'} ${meta?.bg ?? 'bg-white dark:bg-neutral-900'} overflow-hidden`}>
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className={`p-1.5 rounded-lg ${meta?.bg ?? ''}`}>
          <Icon size={15} className={meta?.color ?? 'text-neutral-500'} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{entry.item.name || 'Unnamed'}</p>
          {entry.item.username && (
            <p className="text-xs text-neutral-500 truncate">{entry.item.username}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-1 justify-end">
          {BADGE_SEVERITY.filter((t) => entry.issues.some((i) => i.type === t)).slice(0, 2).map((t) => (
            <IssueBadge key={t} type={t} />
          ))}
        </div>

        {open ? <ChevronUp size={14} className="flex-shrink-0 text-neutral-400" /> : <ChevronDown size={14} className="flex-shrink-0 text-neutral-400" />}
      </div>

      {open && (
        <div className="border-t border-inherit px-3 pb-3 pt-2 space-y-2">
          {/* All issues for this item */}
          <div className="flex flex-wrap gap-1">
            {BADGE_SEVERITY.filter((t) => entry.issues.some((i) => i.type === t)).map((t) => {
              const iss = entry.issues.find((i) => i.type === t);
              return (
                <span key={t} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${ISSUE_META[t]?.color} ${ISSUE_META[t]?.bg} ${ISSUE_META[t]?.border}`}>
                  {iss?.label ?? ISSUE_META[t]?.label}
                </span>
              );
            })}
          </div>

          {/* Fix wizard */}
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={handleFix}
              className="inline-flex items-center gap-1.5 self-start py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition"
            >
              <Wand2 size={13} /> Generate strong replacement
            </button>

            {suggestion && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800">
                <code className="flex-1 text-xs font-mono break-all select-all">{suggestion}</code>
                <button
                  type="button"
                  onClick={handleCopySuggestion}
                  aria-label="Copy suggested password"
                  className="p-1.5 rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  onClick={handleFix}
                  aria-label="Regenerate suggestion"
                  className="p-1.5 rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            )}

            {suggestion && (
              <StrengthMeter password={suggestion} />
            )}

            {suggestion && (
              <p className="text-xs text-neutral-500">
                Copy this password, then update the item in your vault.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SecurityCenter() {
  const { items } = useVault();
  const { user } = useAuth();
  const { toast } = useToast();

  const [breachMap, setBreachMap] = useState(new Map());
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(null); // { completed, total }
  const [filter, setFilter] = useState('all'); // 'all' | 'breached' | 'reused' | 'weak' | 'old'

  const decryptedItems = useMemo(() => [...items.values()], [items]);

  const { score, band, bandColor, ringColor, counts, flaggedItems } = useMemo(
    () => calculateSecurityScore({
      items: decryptedItems,
      breachMap,
      accountStatus: {
        mfaEnabled: user?.mfaEnabled ?? true,
        recoveryKeyConfirmed: user?.recoveryKeyConfirmed ?? true,
      },
    }),
    [decryptedItems, breachMap, user]
  );

  const loginItemsWithPassword = useMemo(
    () => decryptedItems.filter((i) => !i.deletedAt && i.type === 'login' && i.password),
    [decryptedItems]
  );

  const handleBulkScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanProgress({ completed: 0, total: loginItemsWithPassword.length });

    try {
      const pairs = loginItemsWithPassword.map((i) => ({ id: i._id, password: i.password }));
      const results = await checkBreachBulk(pairs, 4, (p) => setScanProgress(p));
      setBreachMap(results);
      const breachedCount = [...results.values()].filter((r) => r.breached).length;
      if (breachedCount > 0) {
        toast(`${breachedCount} password${breachedCount > 1 ? 's' : ''} found in known data breaches`, 'error');
      } else {
        toast('Breach scan complete — no breaches found', 'success');
      }
    } catch {
      toast('Breach scan failed. Check your connection.', 'error');
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }, [scanning, loginItemsWithPassword, toast]);

  const filtered = useMemo(() => {
    if (filter === 'all') return flaggedItems;
    return flaggedItems.filter((e) => e.issues.some((i) => i.type === filter));
  }, [flaggedItems, filter]);

  const FILTERS = [
    { key: 'all', label: `All (${flaggedItems.length})` },
    { key: 'breached', label: `Breached (${counts.breached})` },
    { key: 'reused', label: `Reused (${counts.reused})` },
    { key: 'weak', label: `Weak (${counts.weak})` },
    { key: 'old', label: `Old (${counts.old})` },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security Center</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          Identify and fix weak, reused, breached, and old passwords
        </p>
      </div>

      {/* Score summary bar */}
      <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex items-center gap-4">
        <div className="flex flex-col items-center min-w-[60px]">
          <span className={`text-3xl font-bold ${bandColor}`}>{score}</span>
          <span className="text-xs text-neutral-500">/ 100</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">{band} security score</p>
          <div className="mt-1.5 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-2 rounded-full transition-all duration-700"
              style={{ width: `${score}%`, backgroundColor: ringColor }}
            />
          </div>
        </div>
      </div>

      {/* HIBP bulk scan */}
      <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold">Breach Check (Have I Been Pwned)</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            Scans {loginItemsWithPassword.length} password{loginItemsWithPassword.length !== 1 ? 's' : ''} using k-anonymity — only 5 hex chars sent
          </p>
          {scanProgress && (
            <p className="text-xs text-indigo-500 mt-1" aria-live="polite">
              Checking {scanProgress.completed} / {scanProgress.total}…
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleBulkScan}
          disabled={scanning || loginItemsWithPassword.length === 0}
          className="inline-flex items-center gap-2 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
          aria-label="Run breach scan"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <ShieldX size={14} />}
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
      </div>

      {/* Flagged items */}
      {flaggedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-3">
            <ShieldAlert size={24} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">No issues found</p>
          <p className="text-xs text-neutral-500 mt-1">
            {loginItemsWithPassword.length === 0
              ? 'Add login items to get a security analysis.'
              : 'All passwords look healthy. Run a breach scan for a full check.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Filter tabs */}
          <div className="flex gap-1 flex-wrap" role="tablist">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`py-1.5 px-3 text-xs font-semibold rounded-lg transition ${
                  filter === key
                    ? 'bg-indigo-600 text-white'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Item list */}
          {filtered.length === 0 ? (
            <p className="text-sm text-neutral-500 py-4 text-center">No items match this filter.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((entry) => (
                <FlaggedItemRow
                  key={entry.item._id}
                  entry={entry}
                  onCopy={(msg) => toast(msg, 'info')}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Details section */}
      <details className="text-xs text-neutral-500 dark:text-neutral-400">
        <summary className="cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-200 font-medium">
          How is this calculated?
        </summary>
        <div className="mt-2 space-y-1 pl-2 border-l-2 border-neutral-200 dark:border-neutral-800">
          <p>Each login item with a password receives a penalty for the worst issue it has.</p>
          <p><strong>Breached / Master-equal:</strong> −100 pts each. <strong>Reused:</strong> −70. <strong>Weak:</strong> −60. <strong>Similar:</strong> −40. <strong>Old:</strong> −30.</p>
          <p>Score = 100 − average(penalty) − account deductions. MFA disabled: −10. Recovery key not confirmed: −5.</p>
          <p>Bands: 0–49 Poor · 50–74 Fair · 75–89 Good · 90–100 Excellent.</p>
        </div>
      </details>
    </div>
  );
}
