import { useState, useMemo, useCallback, useEffect } from 'react';
import { useVault } from '../context/VaultContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { copyToClipboard } from '../lib/clipboard.js';
import { generateTotp } from '../lib/totp.js';
import ItemEditor from '../components/ItemEditor.jsx';
import {
  Plus,
  Search,
  X,
  KeyRound,
  FileText,
  CreditCard,
  Code2,
  Star,
  Trash2,
  FolderOpen,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Check,
  RotateCcw,
  AlertTriangle,
  Clock,
  ChevronDown,
  Filter,
} from 'lucide-react';

const TYPE_ICONS = {
  login: KeyRound,
  secureNote: FileText,
  card: CreditCard,
  apiKey: Code2,
};

const TYPE_LABELS = {
  login: 'Login',
  secureNote: 'Secure Note',
  card: 'Card',
  apiKey: 'API Key',
};

function LetterAvatar({ name }) {
  const letter = (name || '?')[0].toUpperCase();
  const colors = [
    'bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-pink-500', 'bg-teal-500',
  ];
  const color = colors[letter.charCodeAt(0) % colors.length];
  return (
    <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
      {letter}
    </div>
  );
}

function TotpBadge({ seed }) {
  const [totpData, setTotpData] = useState({ code: '', remainingSeconds: 0 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let interval;
    const refresh = async () => {
      const data = await generateTotp(seed);
      setTotpData(data);
    };
    refresh();
    interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [seed]);

  const handleCopy = async () => {
    await copyToClipboard(totpData.code, 0);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!totpData.code) return null;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-[11px] font-mono font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition"
      title="Copy TOTP code"
    >
      {copied ? <Check size={11} className="text-emerald-500" /> : null}
      <span>{totpData.code}</span>
      <span className="text-indigo-400 dark:text-indigo-500">({totpData.remainingSeconds}s)</span>
    </button>
  );
}

function ItemCard({ item, onEdit, onTrash, onRestore, onPermanentDelete, isTrash }) {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const { toast } = useToast();

  const handleCopy = useCallback(async (text, fieldLabel) => {
    const result = await copyToClipboard(text, 30);
    if (result.success) {
      setCopiedField(fieldLabel);
      toast(`${fieldLabel} copied — clears in 30s`, 'info');
      setTimeout(() => setCopiedField(''), 3000);
    } else {
      toast('Copy failed', 'error');
    }
  }, [toast]);

  const Icon = TYPE_ICONS[item.type] || KeyRound;

  if (!item.decrypted) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30">
        <div className="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-900/60 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={18} className="text-rose-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-400 truncate">{item.name}</p>
          <p className="text-[11px] text-rose-500 dark:text-rose-500">Decryption failed — ciphertext may be tampered or corrupted</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm transition cursor-pointer"
      onClick={() => onEdit(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onEdit(item)}
      aria-label={`Edit ${item.name}`}
    >
      <LetterAvatar name={item.name} />

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold truncate">{item.name}</span>
            {item.favorite && <Star size={13} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
            {item.deletedAt && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 flex-shrink-0">
                <Trash2 size={10} /> Trash
              </span>
            )}
          </div>
          <span className="text-[11px] text-neutral-400 flex-shrink-0 hidden group-hover:block">
            {TYPE_LABELS[item.type] || item.type}
          </span>
        </div>

        {item.type === 'login' && (
          <div className="space-y-0.5">
            {item.username && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-neutral-500 truncate max-w-[180px]">{item.username}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleCopy(item.username, 'Username'); }}
                  className="opacity-0 group-hover:opacity-100 transition p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  aria-label="Copy username"
                >
                  {copiedField === 'Username' ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} className="text-neutral-400" />}
                </button>
              </div>
            )}
            {item.password && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono text-neutral-500 truncate max-w-[180px]">
                  {showPassword ? item.password : '••••••••'}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowPassword(!showPassword); }}
                  className="opacity-0 group-hover:opacity-100 transition p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  aria-label={showPassword ? 'Hide password' : 'Reveal password'}
                >
                  {showPassword ? <EyeOff size={11} className="text-neutral-400" /> : <Eye size={11} className="text-neutral-400" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleCopy(item.password, 'Password'); }}
                  className="opacity-0 group-hover:opacity-100 transition p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  aria-label="Copy password"
                >
                  {copiedField === 'Password' ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} className="text-neutral-400" />}
                </button>
              </div>
            )}
            {item.totpSeed && <TotpBadge seed={item.totpSeed} />}
          </div>
        )}

        {item.type === 'card' && item.card && (
          <p className="text-[11px] text-neutral-500 truncate">
            {item.card.brand} •••• {(item.card.cardNumber || '').slice(-4)}
          </p>
        )}

        {item.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {item.tags.slice(0, 3).map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        {isTrash ? (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRestore(item._id); }}
              className="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-600"
              aria-label="Restore item"
              title="Restore from trash"
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPermanentDelete(item._id, item.name); }}
              className="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-500"
              aria-label="Permanently delete"
              title="Permanently delete"
            >
              <X size={15} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTrash(item._id, item.name); }}
            className="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-400"
            aria-label="Move to trash"
            title="Move to trash"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function Vault() {
  const { items, folders, syncing, syncError, syncVault, trashItem, restoreItem, permanentDeleteItem, emptyTrash } = useVault();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterFolder, setFilterFolder] = useState('');
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [sortBy, setSortBy] = useState('name'); // name | updated

  const [editingItem, setEditingItem] = useState(null); // null = closed, 'new' = new, item = edit
  const [confirmDialog, setConfirmDialog] = useState(null); // { action, id, name }

  // ── Keyboard shortcut: N = new item, / = focus search ──────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setEditingItem('new'); }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('vaultSearch')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Filtered & sorted items ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items;

    if (showTrash) {
      list = list.filter((it) => it.deletedAt);
    } else {
      list = list.filter((it) => !it.deletedAt);
    }

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((it) =>
        it.name?.toLowerCase().includes(q) ||
        it.username?.toLowerCase().includes(q) ||
        it.uris?.some((u) => u.toLowerCase().includes(q)) ||
        it.notes?.toLowerCase().includes(q) ||
        it.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (filterType !== 'all') list = list.filter((it) => it.type === filterType);
    if (filterFolder) list = list.filter((it) => it.folderId === filterFolder);
    if (filterFavorite) list = list.filter((it) => it.favorite);

    list = [...list].sort((a, b) => {
      if (sortBy === 'updated') return new Date(b.updatedAt) - new Date(a.updatedAt);
      return (a.name || '').localeCompare(b.name || '');
    });

    return list;
  }, [items, search, filterType, filterFolder, filterFavorite, showTrash, sortBy]);

  const trashCount = useMemo(() => items.filter((it) => it.deletedAt).length, [items]);
  const activeCount = useMemo(() => items.filter((it) => !it.deletedAt).length, [items]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleTrash = useCallback((id, name) => {
    setConfirmDialog({ action: 'trash', id, name });
  }, []);

  const handlePermanentDelete = useCallback((id, name) => {
    setConfirmDialog({ action: 'permanent', id, name });
  }, []);

  const handleEmptyTrash = useCallback(() => {
    setConfirmDialog({ action: 'emptyTrash', id: null, name: `all ${trashCount} items` });
  }, [trashCount]);

  const confirmAction = useCallback(async () => {
    if (!confirmDialog) return;
    const { action, id } = confirmDialog;
    try {
      if (action === 'trash') {
        await trashItem(id);
        toast('Moved to trash', 'success');
      } else if (action === 'permanent') {
        await permanentDeleteItem(id);
        toast('Permanently deleted', 'success');
      } else if (action === 'emptyTrash') {
        await emptyTrash();
        toast('Trash emptied', 'success');
      }
    } catch (err) {
      toast(err.message || 'Action failed', 'error');
    } finally {
      setConfirmDialog(null);
    }
  }, [confirmDialog, trashItem, permanentDeleteItem, emptyTrash, toast]);

  const handleRestore = useCallback(async (id) => {
    try {
      await restoreItem(id);
      toast('Item restored', 'success');
    } catch (err) {
      toast(err.message || 'Restore failed', 'error');
    }
  }, [restoreItem, toast]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vault</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {activeCount} item{activeCount !== 1 ? 's' : ''} · all encrypted end-to-end
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={syncVault}
            disabled={syncing}
            className="p-2 rounded-lg text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
            title="Sync vault"
            aria-label="Sync vault"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          </button>
          <button
            id="newItemBtn"
            type="button"
            onClick={() => setEditingItem('new')}
            className="inline-flex items-center gap-1.5 py-2 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition"
          >
            <Plus size={15} />
            New Item
          </button>
        </div>
      </div>

      {/* Sync error */}
      {syncError && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400" role="alert">
          Sync failed: {syncError}
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            id="vaultSearch"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vault… (/)"
            aria-label="Search vault items"
            className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="relative">
          <select
            id="filterType"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filter by type"
            className="appearance-none pl-3 pr-7 py-2 text-xs border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Types</option>
            <option value="login">Logins</option>
            <option value="secureNote">Notes</option>
            <option value="card">Cards</option>
            <option value="apiKey">API Keys</option>
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        </div>

        {/* Folder filter */}
        {folders.length > 0 && (
          <div className="relative">
            <select
              id="filterFolder"
              value={filterFolder}
              onChange={(e) => setFilterFolder(e.target.value)}
              aria-label="Filter by folder"
              className="appearance-none pl-3 pr-7 py-2 text-xs border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Folders</option>
              {folders.map((f) => (
                <option key={f._id} value={f._id}>{f.name || 'Encrypted Folder'}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          </div>
        )}

        {/* Favorites toggle */}
        <button
          type="button"
          onClick={() => setFilterFavorite(!filterFavorite)}
          aria-pressed={filterFavorite}
          className={`p-2 rounded-lg border transition ${filterFavorite ? 'border-amber-400 text-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          title="Filter favorites"
          aria-label="Filter favorites"
        >
          <Star size={15} className={filterFavorite ? 'fill-amber-400' : ''} />
        </button>

        {/* Sort */}
        <div className="relative">
          <select
            id="sortBy"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort by"
            className="appearance-none pl-3 pr-7 py-2 text-xs border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="name">A → Z</option>
            <option value="updated">Recently Updated</option>
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        </div>

        {/* Trash toggle */}
        <button
          type="button"
          onClick={() => setShowTrash(!showTrash)}
          aria-pressed={showTrash}
          className={`inline-flex items-center gap-1.5 p-2 rounded-lg border text-xs transition ${showTrash ? 'border-rose-400 text-rose-600 bg-rose-50 dark:bg-rose-950/30' : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          title="View trash"
          aria-label="Toggle trash view"
        >
          <Trash2 size={14} />
          {trashCount > 0 && <span className="font-semibold">{trashCount}</span>}
        </button>
      </div>

      {/* Trash header */}
      {showTrash && (
        <div className="flex items-center justify-between p-3 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-xs">
          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
            <Trash2 size={14} />
            <span>Items in trash are permanently deleted after 30 days.</span>
          </div>
          {trashCount > 0 && (
            <button
              type="button"
              onClick={handleEmptyTrash}
              className="text-rose-600 dark:text-rose-400 font-medium hover:underline"
            >
              Empty Trash
            </button>
          )}
        </div>
      )}

      {/* Syncing skeleton */}
      {syncing && items.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 animate-pulse">
              <div className="w-9 h-9 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-1/3" />
                <div className="h-2.5 bg-neutral-100 dark:bg-neutral-800/60 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!syncing && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center">
            {showTrash ? <Trash2 size={28} className="text-neutral-400" /> : <KeyRound size={28} className="text-indigo-400" />}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {search || filterType !== 'all' || filterFolder || filterFavorite
                ? 'No items match your filters'
                : showTrash
                ? 'Trash is empty'
                : 'Your vault is empty'}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {!search && filterType === 'all' && !filterFolder && !filterFavorite && !showTrash
                ? 'Press N or click "New Item" to add your first credential'
                : 'Try adjusting your search or filters'}
            </p>
          </div>
          {!search && filterType === 'all' && !filterFolder && !filterFavorite && !showTrash && (
            <button
              type="button"
              onClick={() => setEditingItem('new')}
              className="inline-flex items-center gap-1.5 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition"
            >
              <Plus size={14} />
              Add First Item
            </button>
          )}
        </div>
      )}

      {/* Item list */}
      {filtered.length > 0 && (
        <div className="space-y-2" role="list" aria-label="Vault items">
          {filtered.map((item) => (
            <div key={item._id} role="listitem">
              <ItemCard
                item={item}
                onEdit={setEditingItem}
                onTrash={handleTrash}
                onRestore={handleRestore}
                onPermanentDelete={handlePermanentDelete}
                isTrash={showTrash}
              />
            </div>
          ))}
        </div>
      )}

      {/* Item count footer */}
      {filtered.length > 0 && (
        <p className="text-center text-[11px] text-neutral-400 pt-2">
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          {search || filterType !== 'all' ? ' (filtered)' : ''}
        </p>
      )}

      {/* Item Editor Modal */}
      {editingItem !== null && (
        <ItemEditor
          item={editingItem === 'new' ? null : editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => setEditingItem(null)}
        />
      )}

      {/* Confirm dialog (trash / permanent / empty trash) */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-xl max-w-sm w-full space-y-4">
            <div className="flex items-center gap-2 text-amber-500">
              <AlertTriangle size={22} />
              <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                {confirmDialog.action === 'emptyTrash' ? 'Empty Trash?' :
                 confirmDialog.action === 'permanent' ? 'Permanently Delete?' : 'Move to Trash?'}
              </h2>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {confirmDialog.action === 'trash'
                ? `"${confirmDialog.name}" will be moved to trash and automatically deleted after 30 days.`
                : confirmDialog.action === 'permanent'
                ? `"${confirmDialog.name}" will be permanently deleted and cannot be recovered.`
                : `This will permanently delete ${confirmDialog.name} in the trash. This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="py-1.5 px-3 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAction}
                className={`py-1.5 px-3 text-xs font-medium rounded-lg text-white transition ${
                  confirmDialog.action === 'trash'
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {confirmDialog.action === 'trash' ? 'Move to Trash' :
                 confirmDialog.action === 'permanent' ? 'Delete Forever' : 'Empty Trash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
