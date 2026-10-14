import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  Send,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Info,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const EVENT_CATEGORIES = [
  { label: 'All Events', value: '' },
  { label: 'Logins & Auth', value: 'auth.login' },
  { label: 'Auth Failures', value: 'auth.login_failed' },
  { label: 'Master Password Changes', value: 'password.change' },
  { label: 'MFA Events', value: 'mfa.totp_enabled' },
  { label: 'Session Revocations', value: 'session.revoke' },
  { label: 'Vault Exports', value: 'export' },
  { label: 'Account Recovery', value: 'recovery.complete' },
];

function getEventBadge(event) {
  if (event.includes('failed') || event.includes('reuse') || event.includes('locked')) {
    return {
      label: event,
      icon: ShieldAlert,
      color: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900',
    };
  }
  if (event.includes('disable') || event.includes('revoke') || event.includes('delete') || event.includes('reset')) {
    return {
      label: event,
      icon: AlertTriangle,
      color: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900',
    };
  }
  if (event.includes('password') || event.includes('recovery')) {
    return {
      label: event,
      icon: KeyRound,
      color: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900',
    };
  }
  if (event.includes('login') || event.includes('logout')) {
    return {
      label: event,
      icon: event.includes('logout') ? LogOut : LogIn,
      color: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900',
    };
  }
  if (event.includes('send')) {
    return {
      label: event,
      icon: Send,
      color: 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900',
    };
  }
  return {
    label: event,
    icon: ShieldCheck,
    color: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900',
  };
}

export default function Audit() {
  const { accessToken } = useAuth();
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterEvent, setFilterEvent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAudit = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({
        page: String(page),
        limit: '15',
      });
      if (filterEvent) q.set('event', filterEvent);

      const res = await api(`/api/v1/me/audit?${q.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setEvents(res.events || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      setError(err.message || 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, filterEvent]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const handleFilterChange = (e) => {
    setFilterEvent(e.target.value);
    setPage(1);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="text-indigo-600 dark:text-indigo-400" size={24} />
            <h1 className="text-2xl font-bold tracking-tight">Security Audit Log</h1>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Tamper-evident record of account activity, security changes, and authentication attempts. Retained for 365 days.
          </p>
        </div>

        {/* Filter and Refresh */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={filterEvent}
              onChange={handleFilterChange}
              className="pl-8 pr-4 py-1.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              aria-label="Filter audit events by type"
            >
              {EVENT_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          </div>

          <button
            type="button"
            onClick={fetchAudit}
            disabled={loading}
            className="p-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 transition"
            aria-label="Refresh audit events"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Notice */}
      <details className="text-xs p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 text-neutral-600 dark:text-neutral-400">
        <summary className="font-medium cursor-pointer text-indigo-600 dark:text-indigo-400 hover:underline">
          How is my privacy protected in the audit log?
        </summary>
        <p className="mt-2 leading-relaxed">
          VaultGuard redacts all credentials, auth keys, and recovery material from audit logs before persistence.
          IP addresses are anonymized to coarse network prefixes (/24 for IPv4, /48 for IPv6) to prevent exact geolocation.
          Audit events expire automatically after 365 days via MongoDB TTL indexes.
        </p>
      </details>

      {/* Content */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchAudit}
            className="underline font-semibold hover:text-rose-700"
          >
            Retry
          </button>
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 animate-pulse flex items-center justify-between"
            >
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-1/4" />
                <div className="h-3 bg-neutral-100 dark:bg-neutral-800/60 rounded w-1/2" />
              </div>
              <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-20" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3">
          <div className="inline-flex p-3 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400">
            <ClipboardList size={28} />
          </div>
          <h2 className="text-sm font-semibold">No audit events found</h2>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto">
            {filterEvent
              ? 'No events match the selected filter category.'
              : 'Security activity and authentication events will appear here once recorded.'}
          </p>
          {filterEvent && (
            <button
              type="button"
              onClick={() => {
                setFilterEvent('');
                setPage(1);
              }}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
            {events.map((e) => {
              const badge = getEventBadge(e.event);
              const Icon = badge.icon;
              const date = new Date(e.at);
              const formattedDate = date.toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });

              return (
                <div key={e.id} className="p-4 hover:bg-neutral-50/60 dark:hover:bg-neutral-800/40 transition">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 shrink-0 ${badge.color}`}>
                        <Icon size={14} />
                        <span className="font-mono text-[11px]">{badge.label}</span>
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">
                            IP: <span className="font-mono text-neutral-600 dark:text-neutral-400">{e.ipPrefix || 'unknown'}</span>
                          </span>
                        </div>
                        {e.ua && (
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate max-w-md" title={e.ua}>
                            {e.ua}
                          </p>
                        )}
                        {e.meta && Object.keys(e.meta).length > 0 && (
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono mt-1">
                            {Object.entries(e.meta).map(([k, v]) => (
                              <span key={k} className="inline-block mr-2 px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 text-xs text-neutral-500 dark:text-neutral-400 pl-11 sm:pl-0">
                      <time dateTime={e.at}>{formattedDate}</time>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 pt-2 px-1">
            <span>
              Showing {events.length > 0 ? (page - 1) * 15 + 1 : 0}–{Math.min(total, page * 15)} of {total} events
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none transition"
              >
                <ChevronLeft size={14} />
                Previous
              </button>
              <span className="px-2">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none transition"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
