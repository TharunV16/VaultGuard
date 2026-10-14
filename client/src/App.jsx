import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { VaultProvider } from './context/VaultContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import Register from './pages/Register.jsx';
import Login from './pages/Login.jsx';
import Unlock from './pages/Unlock.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';
import Recover from './pages/Recover.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Vault from './pages/Vault.jsx';
import Generator from './pages/Generator.jsx';
import SecurityCenter from './pages/SecurityCenter.jsx';
import Send from './pages/Send.jsx';
import SendView from './pages/SendView.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';

function AppRoutes() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-live="polite"
      >
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/recover" element={<Recover />} />
      <Route path="/s/:id" element={<SendView />} />

      {/* Session-only (locked) */}
      <Route
        path="/unlock"
        element={
          status === 'unlocked' ? (
            <Navigate to="/app" replace />
          ) : status === 'unauthenticated' ? (
            <Navigate to="/login" replace />
          ) : (
            <Unlock />
          )
        }
      />

      {/* Protected (unlocked) */}
      <Route
        path="/app/*"
        element={
          status === 'unauthenticated' ? (
            <Navigate to="/login" replace />
          ) : status === 'locked' ? (
            <Navigate to="/unlock" replace />
          ) : (
            <Layout />
          )
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="vault" element={<Vault />} />
        <Route path="generator" element={<Generator />} />
        <Route path="security" element={<SecurityCenter />} />
        <Route path="send" element={<Send />} />
        <Route path="settings" element={<Settings />} />
        <Route path="audit" element={<Audit />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <VaultProvider>
            <AppRoutes />
          </VaultProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
