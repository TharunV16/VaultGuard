// @ts-check
import { evaluatePassword } from './strength.js';

/**
 * Normalize a password to detect similar base roots (HLT-02).
 * - Case-folds to lowercase
 * - Normalizes common leetspeak substitutions (@/4->a, 3->e, 1/!/|->i, 0->o, 5/$->s, 7->t)
 * - Strips trailing digits and symbols/punctuation
 * - Returns normalized base if length >= 8, otherwise empty string
 * @param {string} password
 * @returns {string}
 */
export function normalizeSimilarBase(password) {
  if (!password || typeof password !== 'string') return '';
  let str = password.toLowerCase();
  str = str
    .replace(/[@4]/g, 'a')
    .replace(/3/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't');

  // Strip trailing digits and symbols/punctuation
  str = str.replace(/[\d\W_]+$/g, '');

  return str.length >= 8 ? str : '';
}

/**
 * Check if a password is older than 180 days (HLT-03).
 * @param {string|Date} dateStr
 * @returns {boolean}
 */
export function isPasswordOld(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  const maxAgeMs = 180 * 24 * 60 * 60 * 1000; // 180 days
  return ageMs > maxAgeMs;
}

/**
 * Calculate the Security Score according to Appendix B & SCR-01.
 *
 * Per login item with a password, the item penalty is the MAXIMUM applicable:
 * - breached = 100
 * - master-equal = 100
 * - reused = 70
 * - weak = 60
 * - similar = 40
 * - old = 30
 * - else 0
 *
 * vaultScore = 100 - average(itemPenalty) (100 if none)
 * accountPenalty = 0, + 10 if MFA not enabled, + 5 if recovery key not confirmed.
 * Score = clamp(round(vaultScore - accountPenalty), 0, 100)
 *
 * Bands: 0–49 Poor, 50–74 Fair, 75–89 Good, 90–100 Excellent.
 *
 * @param {object} params
 * @param {Array<object>} params.items - decrypted vault items
 * @param {Map<string, { breached: boolean, count: number, error?: boolean }>} [params.breachMap] - item ID -> breach status
 * @param {string} [params.masterPassword] - optional master password to check equality (HLT-05)
 * @param {object} [params.accountStatus] - { mfaEnabled: boolean, recoveryKeyConfirmed: boolean }
 * @returns {object} Full analysis and score
 */
export function calculateSecurityScore({
  items = [],
  breachMap = new Map(),
  masterPassword = '',
  accountStatus = { mfaEnabled: true, recoveryKeyConfirmed: true },
}) {
  // Only active login items with passwords count towards the vault score (SRS Appendix B)
  const loginItems = items.filter(
    (item) => !item.deletedAt && item.type === 'login' && Boolean(item.password)
  );

  // 1. Group by exact password for reuse detection (HLT-01)
  const passwordCounts = new Map();
  for (const item of loginItems) {
    const pwd = item.password;
    passwordCounts.set(pwd, (passwordCounts.get(pwd) || 0) + 1);
  }

  // 2. Group by normalized base for similarity detection (HLT-02)
  const similarGroups = new Map();
  for (const item of loginItems) {
    const base = normalizeSimilarBase(item.password);
    if (base) {
      if (!similarGroups.has(base)) similarGroups.set(base, []);
      similarGroups.get(base).push(item);
    }
  }

  let totalPenalty = 0;
  const flaggedItems = [];
  const counts = {
    totalLoginsWithPassword: loginItems.length,
    weak: 0,
    reused: 0,
    breached: 0,
    old: 0,
    similar: 0,
    masterEqual: 0,
    totalIssues: 0,
  };

  const reusedItemsSet = new Set();
  const similarItemsSet = new Set();
  const weakItemsSet = new Set();
  const breachedItemsSet = new Set();
  const oldItemsSet = new Set();
  const masterEqualItemsSet = new Set();

  for (const item of loginItems) {
    const pwd = item.password;
    const issues = [];

    // Master-equal check (HLT-05)
    if (masterPassword && pwd === masterPassword) {
      issues.push({ type: 'masterEqual', label: 'Matches Master Password', penalty: 100 });
      masterEqualItemsSet.add(item._id);
    }

    // Breached check (BRE-01, BRE-02)
    const breachInfo = breachMap.get(item._id);
    if (breachInfo?.breached) {
      issues.push({
        type: 'breached',
        label: `Found in ${breachInfo.count.toLocaleString()} data breaches`,
        penalty: 100,
        count: breachInfo.count,
      });
      breachedItemsSet.add(item._id);
    }

    // Reuse check (HLT-01: identical password on >= 2 login items)
    const reuseCount = passwordCounts.get(pwd) || 1;
    if (reuseCount > 1) {
      issues.push({
        type: 'reused',
        label: `Reused on ${reuseCount} accounts`,
        penalty: 70,
        count: reuseCount,
      });
      reusedItemsSet.add(item._id);
    }

    // Weak check (HLT-04: zxcvbn score < 3)
    const strength = evaluatePassword(pwd, [item.name, item.username].filter(Boolean));
    if (strength.score < 3) {
      issues.push({
        type: 'weak',
        label: `Weak password (${strength.label})`,
        penalty: 60,
        score: strength.score,
        crackTime: strength.crackTime,
      });
      weakItemsSet.add(item._id);
    }

    // Similar check (HLT-02: same normalized base across >= 2 items, only if not already exact reuse)
    if (reuseCount === 1) {
      const base = normalizeSimilarBase(pwd);
      if (base && (similarGroups.get(base)?.length || 0) > 1) {
        issues.push({
          type: 'similar',
          label: 'Similar variation of another password',
          penalty: 40,
          base,
        });
        similarItemsSet.add(item._id);
      }
    }

    // Old check (HLT-03: unchanged for > 180 days)
    const lastChanged = item.passwordUpdatedAt || item.updatedAt || item.createdAt;
    if (isPasswordOld(lastChanged)) {
      issues.push({
        type: 'old',
        label: 'Unchanged for over 180 days',
        penalty: 30,
        lastChanged,
      });
      oldItemsSet.add(item._id);
    }

    // Maximum applicable penalty per Appendix B
    const maxPenalty = issues.reduce((max, issue) => Math.max(max, issue.penalty), 0);
    totalPenalty += maxPenalty;

    if (issues.length > 0) {
      flaggedItems.push({
        item,
        issues,
        maxPenalty,
      });
    }
  }

  counts.weak = weakItemsSet.size;
  counts.reused = reusedItemsSet.size;
  counts.breached = breachedItemsSet.size;
  counts.old = oldItemsSet.size;
  counts.similar = similarItemsSet.size;
  counts.masterEqual = masterEqualItemsSet.size;
  counts.totalIssues = flaggedItems.length;

  const averagePenalty = loginItems.length > 0 ? totalPenalty / loginItems.length : 0;
  const vaultScore = Math.max(0, 100 - averagePenalty);

  // Account penalties (SCR-01 & Appendix B)
  let accountPenalty = 0;
  if (!accountStatus?.mfaEnabled) {
    accountPenalty += 10;
  }
  if (!accountStatus?.recoveryKeyConfirmed) {
    accountPenalty += 5;
  }

  const score = Math.max(0, Math.min(100, Math.round(vaultScore - accountPenalty)));

  // Score Bands: 0–49 Poor, 50–74 Fair, 75–89 Good, 90–100 Excellent
  let band = 'Excellent';
  let bandColor = 'text-emerald-500';
  let ringColor = '#10b981'; // emerald-500

  if (score < 50) {
    band = 'Poor';
    bandColor = 'text-rose-500';
    ringColor = '#f43f5e'; // rose-500
  } else if (score < 75) {
    band = 'Fair';
    bandColor = 'text-amber-500';
    ringColor = '#f59e0b'; // amber-500
  } else if (score < 90) {
    band = 'Good';
    bandColor = 'text-indigo-500';
    ringColor = '#6366f1'; // indigo-500
  }

  return {
    score,
    band,
    bandColor,
    ringColor,
    vaultScore: Math.round(vaultScore),
    accountPenalty,
    counts,
    flaggedItems,
  };
}
