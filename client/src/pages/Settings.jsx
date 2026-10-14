import { useState } from 'react';
import MfaSetup from '../components/MfaSetup.jsx';
import { ShieldCheck, User, Sliders } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('security');
  const { user } = useAuth();

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Manage your account security, multi-factor authentication, and vault preferences.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-1.5 py-2.5 px-4 font-medium border-b-2 transition ${
            activeTab === 'security'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          <ShieldCheck size={16} />
          Security & MFA
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-1.5 py-2.5 px-4 font-medium border-b-2 transition ${
            activeTab === 'profile'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          <User size={16} />
          Profile
        </button>
      </div>

      {activeTab === 'security' && (
        <div className="space-y-6">
          <MfaSetup />
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3">
          <h2 className="text-sm font-semibold">User Details</h2>
          <div className="text-xs space-y-1">
            <p><span className="text-neutral-400">Email:</span> {user?.email}</p>
            <p><span className="text-neutral-400">Role:</span> {user?.role}</p>
            <p><span className="text-neutral-400">Email Verified:</span> {user?.emailVerified ? 'Yes' : 'No'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
