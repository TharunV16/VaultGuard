import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useState, useCallback } from 'react';
import {
  LayoutDashboard,
  KeyRound,
  Wand2,
  ShieldCheck,
  Send,
  Settings,
  ClipboardList,
  Lock,
  Sun,
  Moon,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useIdleLock } from '../hooks/useIdleLock.js';

const NAV_ITEMS = [
  { to: '/app', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/app/vault', label: 'Vault', Icon: KeyRound },
  { to: '/app/generator', label: 'Generator', Icon: Wand2 },
  { to: '/app/security', label: 'Security', Icon: ShieldCheck },
  { to: '/app/send', label: 'Send', Icon: Send },
  { to: '/app/settings', label: 'Settings', Icon: Settings },
  { to: '/app/audit', label: 'Audit Log', Icon: ClipboardList },
];

function ThemeToggle() {
  const current = document.documentElement.getAttribute('data-theme') ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [theme, setTheme] = useState(current);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('vg-theme', next);
    setTheme(next);
  };

  return (
    <button
      className="btn btn-ghost"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ padding: '0.375rem' }}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export default function Layout() {
  const { lock } = useAuth();
  useIdleLock();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLock = useCallback(() => {
    lock();
    navigate('/unlock');
  }, [lock, navigate]);

  const sidebar = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.75rem', marginBottom: '0.5rem' }} title="VaultGuard - Encrypted Vault & Security Suite">
        <ShieldCheck size={26} color="hsl(var(--accent))" aria-hidden="true" style={{ flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'hsl(var(--accent))', lineHeight: 1.15 }}>VaultGuard</span>
          <span style={{ fontSize: '0.6875rem', color: 'hsl(var(--text-muted))', lineHeight: 1.15, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Encrypted Vault & Security Suite
          </span>
        </div>
      </div>
      <nav aria-label="Main navigation">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            onClick={() => setMobileOpen(false)}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', paddingTop: '1rem' }}>
        <ThemeToggle />
        <button
          className="btn btn-ghost"
          onClick={handleLock}
          aria-label="Lock vault (Ctrl+L)"
          title="Lock vault"
          style={{ padding: '0.375rem' }}
        >
          <Lock size={18} />
        </button>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="sidebar" aria-label="Sidebar navigation">
        {sidebar}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'hsl(220 20% 4% / 0.5)',
          }}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className="sidebar"
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 201,
          display: mobileOpen ? 'flex' : 'none',
        }}
        aria-label="Mobile navigation"
      >
        <button
          className="btn btn-ghost"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          style={{ alignSelf: 'flex-end', marginBottom: '0.5rem' }}
        >
          <X size={18} />
        </button>
        {sidebar}
      </aside>

      {/* Main */}
      <main className="main-content" id="main-content">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav" aria-label="Mobile bottom navigation">
        <button
          className="btn btn-ghost"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          style={{ padding: '0.375rem' }}
        >
          <Menu size={22} />
        </button>
        {NAV_ITEMS.slice(0, 4).map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            style={{ flexDirection: 'column', gap: '0.125rem', padding: '0.25rem 0.5rem', fontSize: '0.625rem' }}
          >
            <Icon size={20} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
        <button
          className="btn btn-ghost"
          onClick={handleLock}
          aria-label="Lock vault"
          style={{ flexDirection: 'column', gap: '0.125rem', padding: '0.25rem 0.5rem', fontSize: '0.625rem' }}
        >
          <Lock size={20} />
          <span>Lock</span>
        </button>
      </nav>
    </div>
  );
}
