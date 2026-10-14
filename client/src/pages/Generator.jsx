import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  generatePassword,
  generatePassphrase,
  generatePin,
  calculateEntropy,
  loadGeneratorOptions,
  saveGeneratorOptions,
} from '../lib/generator.js';
import { evaluatePassword } from '../lib/strength.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useToast } from '../context/ToastContext.jsx';
import StrengthMeter from '../components/StrengthMeter.jsx';
import {
  Wand2,
  RefreshCw,
  Copy,
  Check,
  Shield,
  KeyRound,
  FileText,
  Hash,
  Plus,
} from 'lucide-react';

export default function Generator() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mode, setMode] = useState('password'); // 'password' | 'passphrase' | 'pin'
  const [copied, setCopied] = useState(false);

  // Password options
  const [pwdLength, setPwdLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);

  // Passphrase options
  const [words, setWords] = useState(6);
  const [separator, setSeparator] = useState('-');
  const [capitalize, setCapitalize] = useState(true);
  const [includeNumber, setIncludeNumber] = useState(true);

  // PIN options
  const [pinLength, setPinLength] = useState(6);

  // Generated output
  const [generatedValue, setGeneratedValue] = useState('');

  // Load saved options on mount (GEN-05)
  useEffect(() => {
    const saved = loadGeneratorOptions();
    if (saved) {
      if (saved.mode) setMode(saved.mode);
      if (saved.pwdLength) setPwdLength(saved.pwdLength);
      if (saved.uppercase !== undefined) setUppercase(saved.uppercase);
      if (saved.lowercase !== undefined) setLowercase(saved.lowercase);
      if (saved.numbers !== undefined) setNumbers(saved.numbers);
      if (saved.symbols !== undefined) setSymbols(saved.symbols);
      if (saved.excludeAmbiguous !== undefined) setExcludeAmbiguous(saved.excludeAmbiguous);
      if (saved.words) setWords(saved.words);
      if (saved.separator !== undefined) setSeparator(saved.separator);
      if (saved.capitalize !== undefined) setCapitalize(saved.capitalize);
      if (saved.includeNumber !== undefined) setIncludeNumber(saved.includeNumber);
      if (saved.pinLength) setPinLength(saved.pinLength);
    }
  }, []);

  // Save non-secret options when changed
  useEffect(() => {
    saveGeneratorOptions({
      mode,
      pwdLength,
      uppercase,
      lowercase,
      numbers,
      symbols,
      excludeAmbiguous,
      words,
      separator,
      capitalize,
      includeNumber,
      pinLength,
    });
  }, [
    mode,
    pwdLength,
    uppercase,
    lowercase,
    numbers,
    symbols,
    excludeAmbiguous,
    words,
    separator,
    capitalize,
    includeNumber,
    pinLength,
  ]);

  const regenerate = useCallback(() => {
    if (mode === 'password') {
      const val = generatePassword({
        length: pwdLength,
        uppercase,
        lowercase,
        numbers,
        symbols,
        excludeAmbiguous,
      });
      setGeneratedValue(val);
    } else if (mode === 'passphrase') {
      const val = generatePassphrase({
        words,
        separator,
        capitalize,
        includeNumber,
      });
      setGeneratedValue(val);
    } else if (mode === 'pin') {
      const val = generatePin(pinLength);
      setGeneratedValue(val);
    }
  }, [
    mode,
    pwdLength,
    uppercase,
    lowercase,
    numbers,
    symbols,
    excludeAmbiguous,
    words,
    separator,
    capitalize,
    includeNumber,
    pinLength,
  ]);

  // Generate on option changes
  useEffect(() => {
    regenerate();
  }, [regenerate]);

  const handleCopy = async () => {
    if (!generatedValue) return;
    const res = await copyToClipboard(generatedValue, 30);
    if (res.success) {
      setCopied(true);
      toast('Copied to clipboard — clears in 30 seconds', 'info');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast('Failed to copy', 'error');
    }
  };

  const entropy = calculateEntropy(mode, {
    length: mode === 'password' ? pwdLength : pinLength,
    uppercase,
    lowercase,
    numbers,
    symbols,
    excludeAmbiguous,
    words,
    includeNumber,
  });

  const strength = evaluatePassword(generatedValue);

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Password Generator</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          Generate cryptographically strong passwords, passphrases, and PINs (GEN-01..05)
        </p>
      </div>

      {/* Mode Tabs */}
      <div className="flex p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          onClick={() => setMode('password')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition ${
            mode === 'password'
              ? 'bg-white dark:bg-neutral-900 shadow-sm text-indigo-600 dark:text-indigo-400'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <KeyRound size={14} />
          Random Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'passphrase'}
          onClick={() => setMode('passphrase')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition ${
            mode === 'passphrase'
              ? 'bg-white dark:bg-neutral-900 shadow-sm text-indigo-600 dark:text-indigo-400'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <FileText size={14} />
          Passphrase
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'pin'}
          onClick={() => setMode('pin')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition ${
            mode === 'pin'
              ? 'bg-white dark:bg-neutral-900 shadow-sm text-indigo-600 dark:text-indigo-400'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Hash size={14} />
          PIN Code
        </button>
      </div>

      {/* Output Display Card */}
      <div className="p-4 md:p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 font-mono text-base md:text-lg break-all select-all font-semibold tracking-wide text-neutral-900 dark:text-neutral-100">
            {generatedValue || '…'}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={regenerate}
              className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              title="Regenerate"
              aria-label="Regenerate password"
            >
              <RefreshCw size={17} />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition shadow-sm"
              aria-label="Copy generated password"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Strength & Entropy info */}
        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800/80 space-y-2">
          {mode !== 'pin' && <StrengthMeter password={generatedValue} />}
          <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span className="flex items-center gap-1">
              <Shield size={13} className="text-indigo-500" />
              Entropy: <strong className="text-neutral-800 dark:text-neutral-200">{entropy} bits</strong>
            </span>
            <span>
              Crack time: <strong className="text-neutral-800 dark:text-neutral-200">{strength.crackTime}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <div className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-5">
        {mode === 'password' && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center text-xs font-semibold mb-2">
                <span>Length: {pwdLength} characters</span>
                <span className="text-neutral-400 font-normal">8 to 128</span>
              </div>
              <input
                type="range"
                min="8"
                max="128"
                value={pwdLength}
                onChange={(e) => setPwdLength(parseInt(e.target.value, 10))}
                className="w-full accent-indigo-600 cursor-pointer"
                aria-label="Password length"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={uppercase}
                  onChange={(e) => setUppercase(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>Uppercase (A-Z)</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={lowercase}
                  onChange={(e) => setLowercase(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>Lowercase (a-z)</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={numbers}
                  onChange={(e) => setNumbers(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>Numbers (0-9)</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={symbols}
                  onChange={(e) => setSymbols(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>Symbols (!@#$…)</span>
              </label>
            </div>

            <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
              <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeAmbiguous}
                  onChange={(e) => setExcludeAmbiguous(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>Exclude Ambiguous Characters (O, 0, I, l, 1, |)</span>
              </label>
            </div>
          </div>
        )}

        {mode === 'passphrase' && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center text-xs font-semibold mb-2">
                <span>Words: {words} words</span>
                <span className="text-neutral-400 font-normal">3 to 10 from EFF list</span>
              </div>
              <input
                type="range"
                min="3"
                max="10"
                value={words}
                onChange={(e) => setWords(parseInt(e.target.value, 10))}
                className="w-full accent-indigo-600 cursor-pointer"
                aria-label="Passphrase word count"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium mb-1.5" htmlFor="passphraseSeparator">
                  Word Separator
                </label>
                <input
                  id="passphraseSeparator"
                  type="text"
                  maxLength={3}
                  value={separator}
                  onChange={(e) => setSeparator(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900"
                />
              </div>

              <div className="flex flex-col justify-center space-y-2.5 pt-2">
                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={capitalize}
                    onChange={(e) => setCapitalize(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Capitalize each word</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeNumber}
                    onChange={(e) => setIncludeNumber(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Include a random number</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {mode === 'pin' && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center text-xs font-semibold mb-2">
                <span>PIN Length: {pinLength} digits</span>
                <span className="text-neutral-400 font-normal">4 to 12 digits</span>
              </div>
              <input
                type="range"
                min="4"
                max="12"
                value={pinLength}
                onChange={(e) => setPinLength(parseInt(e.target.value, 10))}
                className="w-full accent-indigo-600 cursor-pointer"
                aria-label="PIN length"
              />
            </div>
          </div>
        )}
      </div>

      {/* Action to create vault item with this password */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate('/app/vault')}
          className="inline-flex items-center gap-1.5 py-2 px-4 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold rounded-lg transition"
        >
          <Plus size={14} />
          Go to Vault to Add Item
        </button>
      </div>
    </div>
  );
}
