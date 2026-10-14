import { evaluatePassword, SCORE_LABELS } from '../lib/strength.js';

const SEGMENT_COLORS = [
  'bg-red-500',    // score 0 / very weak
  'bg-orange-500', // score 1 / weak
  'bg-amber-400',  // score 2 / fair
  'bg-emerald-500',// score 3 / strong
  'bg-emerald-600',// score 4 / very strong
];

/**
 * Accessible 4-segment password strength meter.
 * Never relies on color alone (meets WCAG 2.2 AA).
 */
export default function StrengthMeter({ password, userInputs = [] }) {
  if (!password) return null;

  const { score, label, crackTime, warning, suggestions } = evaluatePassword(password, userInputs);

  const tip = warning || (suggestions.length > 0 ? suggestions[0] : null);

  return (
    <div className="mt-2 space-y-1.5" aria-live="polite">
      {/* 4 segments */}
      <div className="flex gap-1 h-1.5 w-full bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
        {[1, 2, 3, 4].map((step) => {
          const filled = score >= step;
          return (
            <div
              key={step}
              className={`flex-1 transition-all duration-300 ${
                filled ? SEGMENT_COLORS[score] : 'bg-transparent'
              }`}
            />
          );
        })}
      </div>

      {/* Label and crack time */}
      <div className="flex justify-between items-center text-xs">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          Strength: <span className="font-semibold">{label}</span>
        </span>
        <span className="text-neutral-500 dark:text-neutral-400">
          Crack time: {crackTime}
        </span>
      </div>

      {/* Actionable tip if present */}
      {tip && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          💡 {tip}
        </p>
      )}
    </div>
  );
}
