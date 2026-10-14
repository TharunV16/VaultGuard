import { useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVault } from '../context/VaultContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { calculateSecurityScore } from '../lib/score.js';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  AlertTriangle,
  Key,
  RefreshCw,
  Lock,
  ChevronRight,
} from 'lucide-react';

// ponytail: recharts lazy-loaded per skill.md section 11 (bundle budget)
const RadialBarChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.RadialBarChart }))
);
const RadialBar = lazy(() =>
  import('recharts').then((m) => ({ default: m.RadialBar }))
);

/** Score ring using SVG (avoids recharts SSR weight on initial load) */
function ScoreRing({ score, ringColor, band, bandColor }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="140" height="140" viewBox="0 0 140 140" aria-label={`Security score: ${score} — ${band}`}>
        {/* Track */}
        <circle cx="70" cy="70" r={r} fill="none" stroke="currentColor" strokeWidth="12"
          className="text-neutral-200 dark:text-neutral-800" />
        {/* Progress */}
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={ringColor}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        {/* Score text */}
        <text x="70" y="66" textAnchor="middle" dominantBaseline="middle"
          fontSize="28" fontWeight="700" fill={ringColor}>{score}</text>
        <text x="70" y="88" textAnchor="middle" dominantBaseline="middle"
          fontSize="11" fill="currentColor" className="fill-neutral-500">/100</text>
      </svg>
      <span className={`text-sm font-semibold ${bandColor}`}>{band}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, onClick }) {
  const el = (
    <div
      className={`flex items-center gap-3 p-4 rounded-xl border bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 ${onClick ? 'cursor-pointer hover:border-indigo-400 transition' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon size={16} className="text-white" />
      </div>
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
  return el;
}

export default function Dashboard() {
  const { items } = useVault();
  const { user } = useAuth();
  const navigate = useNavigate();

  const decryptedItems = useMemo(() => items, [items]);

  const { score, band, bandColor, ringColor, counts, flaggedItems, accountPenalty } =
    useMemo(() => calculateSecurityScore({
      items: decryptedItems,
      accountStatus: {
        mfaEnabled: user?.mfaEnabled ?? true,
        recoveryKeyConfirmed: user?.recoveryKeyConfirmed ?? true,
      },
    }), [decryptedItems, user]);

  const ScoreIcon =
    score >= 90 ? ShieldCheck
    : score >= 75 ? ShieldCheck
    : score >= 50 ? ShieldAlert
    : ShieldX;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          Your vault health at a glance
        </p>
      </div>

      {/* Score + breakdown */}
      <div className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col sm:flex-row items-center gap-6">
        <ScoreRing score={score} ringColor={ringColor} band={band} bandColor={bandColor} />

        <div className="flex-1 space-y-3 w-full">
          <h2 className="text-sm font-semibold">Security Score Breakdown</h2>

          {counts.totalLoginsWithPassword === 0 ? (
            <p className="text-xs text-neutral-500">No login items yet. Add credentials to get a score.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {counts.weak > 0 && (
                <li className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={12} /> {counts.weak} weak password{counts.weak > 1 ? 's' : ''}
                </li>
              )}
              {counts.reused > 0 && (
                <li className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <RefreshCw size={12} /> {counts.reused} reused password{counts.reused > 1 ? 's' : ''}
                </li>
              )}
              {counts.breached > 0 && (
                <li className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  <ShieldX size={12} /> {counts.breached} breached password{counts.breached > 1 ? 's' : ''}
                </li>
              )}
              {counts.old > 0 && (
                <li className="flex items-center gap-2 text-neutral-500">
                  <RefreshCw size={12} /> {counts.old} password{counts.old > 1 ? 's' : ''} older than 180 days
                </li>
              )}
              {counts.similar > 0 && (
                <li className="flex items-center gap-2 text-neutral-500">
                  <Key size={12} /> {counts.similar} similar variation{counts.similar > 1 ? 's' : ''}
                </li>
              )}
              {accountPenalty > 0 && (
                <li className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                  <Lock size={12} /> Account security deduction: -{accountPenalty} pts
                  {!user?.mfaEnabled && ' (MFA not enabled)'}
                  {!user?.recoveryKeyConfirmed && ' (recovery key not confirmed)'}
                </li>
              )}
              {counts.totalIssues === 0 && accountPenalty === 0 && (
                <li className="text-emerald-600 dark:text-emerald-400">✓ No issues found</li>
              )}
            </ul>
          )}

          {flaggedItems.length > 0 && (
            <button
              type="button"
              onClick={() => navigate('/app/security')}
              className="inline-flex items-center gap-1 mt-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
            >
              View all issues in Security Center <ChevronRight size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Key}
          label="Total items"
          value={decryptedItems.filter((i) => !i.deletedAt).length}
          color="bg-indigo-500"
        />
        <StatCard
          icon={AlertTriangle}
          label="Issues"
          value={counts.totalIssues}
          color={counts.totalIssues > 0 ? 'bg-amber-500' : 'bg-emerald-500'}
          onClick={counts.totalIssues > 0 ? () => navigate('/app/security') : undefined}
        />
        <StatCard
          icon={ShieldX}
          label="Breached"
          value={counts.breached}
          color={counts.breached > 0 ? 'bg-rose-500' : 'bg-emerald-500'}
          onClick={counts.breached > 0 ? () => navigate('/app/security') : undefined}
        />
        <StatCard
          icon={RefreshCw}
          label="Reused"
          value={counts.reused}
          color={counts.reused > 0 ? 'bg-orange-500' : 'bg-emerald-500'}
          onClick={counts.reused > 0 ? () => navigate('/app/security') : undefined}
        />
      </div>

      {/* Call to action */}
      {!user?.mfaEnabled && (
        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">Enable two-factor authentication</p>
            <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">Protect your account with TOTP or passkeys.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/app/settings')}
            className="text-xs font-semibold px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            Set up MFA
          </button>
        </div>
      )}
    </div>
  );
}
