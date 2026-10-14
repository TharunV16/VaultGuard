import { useState, useRef, useEffect } from 'react';
import { useVault } from '../context/VaultContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { generatePassword } from '../lib/generator.js';
import PasswordField from './PasswordField.jsx';
import StrengthMeter from './StrengthMeter.jsx';
import {
  KeyRound,
  FileText,
  CreditCard,
  Code2,
  Wand2,
  History,
  X,
  AlertTriangle,
  Star,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react';

const ITEM_TYPES = [
  { id: 'login', label: 'Login', icon: KeyRound },
  { id: 'secureNote', label: 'Secure Note', icon: FileText },
  { id: 'card', label: 'Payment Card', icon: CreditCard },
  { id: 'apiKey', label: 'API Key', icon: Code2 },
];

export default function ItemEditor({ item, onClose, onSaved }) {
  const isEdit = Boolean(item?._id);
  const { createItem, updateItem, folders } = useVault();
  const { toast } = useToast();

  const [type, setType] = useState(item?.type || 'login');
  const [name, setName] = useState(item?.name || '');
  const [folderId, setFolderId] = useState(item?.folderId || '');
  const [favorite, setFavorite] = useState(Boolean(item?.favorite));
  const [tags, setTags] = useState(item?.tags ? item.tags.join(', ') : '');
  const [notes, setNotes] = useState(item?.notes || '');

  // Login specific
  const [username, setUsername] = useState(item?.username || '');
  const [password, setPassword] = useState(item?.password || '');
  const [uri, setUri] = useState(item?.uris?.[0] || '');
  const [totpSeed, setTotpSeed] = useState(item?.totpSeed || '');
  const [history, setHistory] = useState(item?.history || []);

  // Card specific
  const [cardholderName, setCardholderName] = useState(item?.card?.cardholderName || '');
  const [cardNumber, setCardNumber] = useState(item?.card?.cardNumber || '');
  const [brand, setBrand] = useState(item?.card?.brand || 'Visa');
  const [expMonth, setExpMonth] = useState(item?.card?.expMonth || '');
  const [expYear, setExpYear] = useState(item?.card?.expYear || '');
  const [cvv, setCvv] = useState(item?.card?.cvv || '');
  const [pin, setPin] = useState(item?.card?.pin || '');

  // API Key specific
  const [apiKeyValue, setApiKeyValue] = useState(item?.apiKey?.apiKey || '');
  const [keyId, setKeyId] = useState(item?.apiKey?.keyId || '');
  const [endpoint, setEndpoint] = useState(item?.apiKey?.endpoint || '');

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showGenerator, setShowGenerator] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Generator settings
  const [genLength, setGenLength] = useState(20);
  const [genUpper, setGenUpper] = useState(true);
  const [genLower, setGenLower] = useState(true);
  const [genNum, setGenNum] = useState(true);
  const [genSym, setGenSym] = useState(true);

  // Conflict resolution modal
  const [conflictData, setConflictData] = useState(null);
  const conflictDialogRef = useRef(null);

  useEffect(() => {
    if (conflictData) {
      conflictDialogRef.current?.showModal();
    } else {
      conflictDialogRef.current?.close();
    }
  }, [conflictData]);

  const handleGenerate = () => {
    const generated = generatePassword({
      length: genLength,
      uppercase: genUpper,
      lowercase: genLower,
      numbers: genNum,
      symbols: genSym,
    });
    setPassword(generated);
    toast('Strong password generated', 'info');
  };

  const handleSubmit = async (e, forceRev = null) => {
    e?.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Item name is required');
      return;
    }

    setSaving(true);

    try {
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const baseBlob = {
        type,
        name: name.trim(),
        folderId: folderId || null,
        favorite,
        tags: parsedTags,
        notes: notes.trim(),
      };

      if (type === 'login') {
        baseBlob.username = username.trim();
        baseBlob.password = password;
        baseBlob.uris = uri.trim() ? [uri.trim()] : [];
        baseBlob.totpSeed = totpSeed.trim();

        // Password history tracking (VLT-10)
        let newHistory = [...history];
        let passwordChangedAt = item?.passwordChangedAt || new Date().toISOString();

        if (isEdit && item.password && item.password !== password) {
          newHistory.unshift({
            password: item.password,
            changedAt: item.passwordChangedAt || new Date().toISOString(),
          });
          newHistory = newHistory.slice(0, 5); // Keep last 5
          passwordChangedAt = new Date().toISOString();
        }

        baseBlob.history = newHistory;
        baseBlob.passwordChangedAt = passwordChangedAt;
      } else if (type === 'card') {
        baseBlob.card = {
          cardholderName: cardholderName.trim(),
          cardNumber: cardNumber.replace(/\s/g, ''),
          brand,
          expMonth: expMonth.trim(),
          expYear: expYear.trim(),
          cvv: cvv.trim(),
          pin: pin.trim(),
        };
      } else if (type === 'apiKey') {
        baseBlob.apiKey = {
          apiKey: apiKeyValue.trim(),
          keyId: keyId.trim(),
          endpoint: endpoint.trim(),
        };
      }

      if (isEdit) {
        const revToUse = forceRev !== null ? forceRev : item.rev;
        const res = await updateItem(item._id, baseBlob, revToUse);
        if (res.conflict) {
          setConflictData({
            serverItem: res.serverItem,
            pendingBlob: baseBlob,
          });
          setSaving(false);
          return;
        }
        toast('Item updated', 'success');
        onSaved?.(res.item);
      } else {
        const newItem = await createItem(baseBlob);
        toast('Item created', 'success');
        onSaved?.(newItem);
      }

      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  const resolveConflictKeepMine = async () => {
    if (!conflictData) return;
    const serverRev = conflictData.serverItem.rev;
    setConflictData(null);
    await handleSubmit(null, serverRev);
  };

  const resolveConflictDiscard = () => {
    setConflictData(null);
    toast('Update cancelled. Showing current server version.', 'info');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight">
              {isEdit ? 'Edit Item' : 'New Vault Item'}
            </h2>
            <button
              type="button"
              onClick={() => setFavorite(!favorite)}
              className={`p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition ${
                favorite ? 'text-amber-500 fill-amber-500' : 'text-neutral-400'
              }`}
              title={favorite ? 'Favorited' : 'Mark as favorite'}
            >
              <Star size={18} className={favorite ? 'fill-amber-500' : ''} />
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Type Selector (if new) */}
        {!isEdit && (
          <div className="flex border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-1.5 gap-1 text-xs">
            {ITEM_TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg font-medium transition ${
                    type === t.id
                      ? 'bg-white dark:bg-neutral-800 shadow-sm text-indigo-600 dark:text-indigo-400'
                      : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                  }`}
                >
                  <Icon size={14} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1 text-sm">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900" role="alert">
              {error}
            </div>
          )}

          {/* Item Name */}
          <div>
            <label htmlFor="itemName" className="block text-xs font-semibold mb-1">
              Name *
            </label>
            <input
              id="itemName"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GitHub, Netflix, Work WiFi"
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Folder & Tags Row */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label htmlFor="folderSelect" className="block font-semibold mb-1">
                Folder
              </label>
              <select
                id="folderSelect"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full px-2.5 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">(No folder)</option>
                {folders.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="itemTags" className="block font-semibold mb-1">
                Tags (comma separated)
              </label>
              <input
                id="itemTags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="work, personal, dev"
                className="w-full px-2.5 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* ── Type-specific fields ── */}
          {type === 'login' && (
            <div className="space-y-3 pt-1">
              <div>
                <label htmlFor="loginUsername" className="block text-xs font-semibold mb-1">
                  Username or Email
                </label>
                <input
                  id="loginUsername"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="you@domain.com"
                  className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="loginPassword" className="text-xs font-semibold">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowGenerator(!showGenerator)}
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <Wand2 size={12} />
                    {showGenerator ? 'Close Generator' : 'Generate Strong Password'}
                  </button>
                </div>
                <PasswordField
                  id="loginPassword"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Password"
                />
                {password && <StrengthMeter password={password} userInputs={[name, username, uri]} />}
              </div>

              {/* Embedded Generator Drawer */}
              {showGenerator && (
                <div className="p-3 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Length: {genLength}</span>
                    <input
                      type="range"
                      min={8}
                      max={64}
                      value={genLength}
                      onChange={(e) => setGenLength(parseInt(e.target.value))}
                      className="w-32"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={genUpper} onChange={(e) => setGenUpper(e.target.checked)} />
                      <span>A-Z</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={genLower} onChange={(e) => setGenLower(e.target.checked)} />
                      <span>a-z</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={genNum} onChange={(e) => setGenNum(e.target.checked)} />
                      <span>0-9</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={genSym} onChange={(e) => setGenSym(e.target.checked)} />
                      <span>!@#$%</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    className="w-full mt-2 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium flex items-center justify-center gap-1.5 transition"
                  >
                    <Wand2 size={13} />
                    <span>Generate & Apply</span>
                  </button>
                </div>
              )}

              {/* Password History (VLT-10) */}
              {history.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowHistory(!showHistory)}
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  >
                    <History size={12} />
                    <span>{showHistory ? 'Hide' : 'Show'} Password History ({history.length})</span>
                  </button>
                  {showHistory && (
                    <div className="mt-1.5 p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-1.5">
                      {history.map((h, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                          <span className="truncate max-w-[200px] text-neutral-600 dark:text-neutral-400">••••••••</span>
                          <span className="text-neutral-400">{new Date(h.changedAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="loginUri" className="block text-xs font-semibold mb-1">
                  Website URL
                </label>
                <input
                  id="loginUri"
                  type="url"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="loginTotp" className="block text-xs font-semibold mb-1">
                  Authenticator Key / TOTP Seed (optional)
                </label>
                <input
                  id="loginTotp"
                  type="text"
                  value={totpSeed}
                  onChange={(e) => setTotpSeed(e.target.value)}
                  placeholder="Base32 key or otpauth://totp/..."
                  className="w-full font-mono text-xs px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  Generates live 6-digit TOTP codes directly inside VaultGuard.
                </p>
              </div>
            </div>
          )}

          {type === 'card' && (
            <div className="space-y-3 pt-1 text-xs">
              <div>
                <label htmlFor="cardholder" className="block font-semibold mb-1">
                  Cardholder Name
                </label>
                <input
                  id="cardholder"
                  type="text"
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value)}
                  placeholder="Name on card"
                  className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label htmlFor="cardNumber" className="block font-semibold mb-1">
                    Card Number
                  </label>
                  <input
                    id="cardNumber"
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="4111 2222 3333 4444"
                    className="w-full font-mono px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                  />
                </div>
                <div>
                  <label htmlFor="brand" className="block font-semibold mb-1">
                    Brand
                  </label>
                  <select
                    id="brand"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    className="w-full px-2 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                  >
                    <option>Visa</option>
                    <option>Mastercard</option>
                    <option>Amex</option>
                    <option>Discover</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label htmlFor="expMonth" className="block font-semibold mb-1">
                    Exp Month
                  </label>
                  <input
                    id="expMonth"
                    type="text"
                    maxLength={2}
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value)}
                    placeholder="MM"
                    className="w-full text-center px-2 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                  />
                </div>
                <div>
                  <label htmlFor="expYear" className="block font-semibold mb-1">
                    Exp Year
                  </label>
                  <input
                    id="expYear"
                    type="text"
                    maxLength={4}
                    value={expYear}
                    onChange={(e) => setExpYear(e.target.value)}
                    placeholder="YYYY"
                    className="w-full text-center px-2 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                  />
                </div>
                <div>
                  <label htmlFor="cvv" className="block font-semibold mb-1">
                    CVV
                  </label>
                  <div className="relative">
                    <input
                      id="cvv"
                      type={showCvv ? 'text' : 'password'}
                      maxLength={4}
                      value={cvv}
                      onChange={(e) => setCvv(e.target.value)}
                      placeholder="123"
                      className="w-full text-center font-mono px-2 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 pr-6"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCvv(!showCvv)}
                      className="absolute right-1.5 top-2.5 text-neutral-400 hover:text-neutral-600"
                    >
                      {showCvv ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="pin" className="block font-semibold mb-1">
                    PIN
                  </label>
                  <div className="relative">
                    <input
                      id="pin"
                      type={showPin ? 'text' : 'password'}
                      maxLength={8}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="••••"
                      className="w-full text-center font-mono px-2 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 pr-6"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-1.5 top-2.5 text-neutral-400 hover:text-neutral-600"
                    >
                      {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {type === 'apiKey' && (
            <div className="space-y-3 pt-1 text-xs">
              <div>
                <label htmlFor="apiKeyValue" className="block font-semibold mb-1">
                  API Key / Secret
                </label>
                <input
                  id="apiKeyValue"
                  type="password"
                  value={apiKeyValue}
                  onChange={(e) => setApiKeyValue(e.target.value)}
                  placeholder="sk_live_..."
                  className="w-full font-mono px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                />
              </div>
              <div>
                <label htmlFor="keyId" className="block font-semibold mb-1">
                  Key ID / Client ID (optional)
                </label>
                <input
                  id="keyId"
                  type="text"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="AKIA..."
                  className="w-full font-mono px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                />
              </div>
              <div>
                <label htmlFor="endpoint" className="block font-semibold mb-1">
                  Endpoint URL (optional)
                </label>
                <input
                  id="endpoint"
                  type="url"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://api.service.com"
                  className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label htmlFor="itemNotes" className="block text-xs font-semibold mb-1">
              Notes
            </label>
            <textarea
              id="itemNotes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional secure notes, recovery codes, or details..."
              className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-neutral-200 dark:border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="py-2 px-4 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="py-2 px-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5"
            >
              {saving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <span>{saving ? 'Encrypting & Saving…' : isEdit ? 'Save Changes' : 'Create Item'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Conflict Resolution Dialog (VLT-03) */}
      <dialog
        ref={conflictDialogRef}
        className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 backdrop:bg-black/50 shadow-2xl max-w-md w-full"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-amber-500">
            <AlertTriangle size={24} />
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              Concurrent Modification Conflict
            </h3>
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            This item was modified in another window or session while you were editing it.
            How would you like to resolve this conflict?
          </p>

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={resolveConflictKeepMine}
              className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition"
            >
              Keep My Changes (Overwrite server version)
            </button>
            <button
              type="button"
              onClick={resolveConflictDiscard}
              className="w-full py-2 px-4 border border-neutral-300 dark:border-neutral-700 rounded-lg text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
            >
              Discard My Changes (Keep server version)
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
