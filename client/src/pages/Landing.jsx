import { ShieldCheck, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
        gap: '1.5rem',
      }}
    >
      <ShieldCheck size={56} color="hsl(var(--accent))" aria-hidden="true" />
      <h1 style={{ margin: 0, fontSize: 'clamp(1.75rem, 5vw, 3rem)', fontWeight: 800 }}>
        VaultGuard
      </h1>
      <p style={{ maxWidth: '36ch', color: 'hsl(var(--text-muted))', fontSize: '1.125rem', margin: 0 }}>
        A password manager that coaches you, and can't read your secrets even if it wanted to.
      </p>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/register" className="btn btn-primary" style={{ fontSize: '1rem', padding: '0.75rem 1.5rem' }}>
          Get started <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <Link to="/login" className="btn btn-secondary" style={{ fontSize: '1rem', padding: '0.75rem 1.5rem' }}>
          Sign in
        </Link>
      </div>
      <details style={{ maxWidth: '40ch', color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
        <summary style={{ cursor: 'pointer' }}>How is this protected?</summary>
        <p style={{ marginTop: '0.5rem', textAlign: 'left' }}>
          Your passwords are encrypted in your browser before they ever leave your device.
          Not even our servers can read them. Your master password never leaves your device.
        </p>
      </details>
    </div>
  );
}
