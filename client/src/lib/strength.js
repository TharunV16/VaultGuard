import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';

let initialized = false;

function initOptions() {
  if (initialized) return;
  zxcvbnOptions.setOptions({
    translations: zxcvbnEnPackage.translations,
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommonPackage.dictionary,
      ...zxcvbnEnPackage.dictionary,
    },
  });
  initialized = true;
}

/**
 * Score labels for zxcvbn 0..4
 */
export const SCORE_LABELS = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];

/**
 * Evaluate password strength with zxcvbn.
 * @param {string} password
 * @param {string[]} [userInputs] - e.g. [email, username] to penalize personal data in passwords
 * @returns {{ score: number, label: string, crackTime: string, warning: string, suggestions: string[] }}
 */
export function evaluatePassword(password, userInputs = []) {
  if (!password) {
    return {
      score: 0,
      label: 'Too short',
      crackTime: 'instant',
      warning: '',
      suggestions: ['Enter at least 12 characters'],
    };
  }

  initOptions();
  const res = zxcvbn(password, userInputs);

  return {
    score: res.score,
    label: SCORE_LABELS[res.score],
    crackTime: res.crackTimesDisplay.offlineSlowHashing1e4PerSecond || 'instant',
    warning: res.feedback.warning || '',
    suggestions: res.feedback.suggestions || [],
  };
}
