import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

/**
 * Hook to automatically lock vault after inactive period.
 * Reads autoLockMinutes from user.settings (default 5 min).
 */
export function useIdleLock() {
  const { status, lock, user } = useAuth();
  const timerRef = useRef(null);

  const minutes = user?.settings?.autoLockMinutes || 5;
  const timeoutMs = minutes * 60 * 1000;

  useEffect(() => {
    if (status !== 'unlocked') return;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lock();
      }, timeoutMs);
    };

    resetTimer();

    const handleActivity = () => resetTimer();
    EVENTS.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      EVENTS.forEach((e) => window.removeEventListener(e, handleActivity));
    };
  }, [status, timeoutMs, lock]);
}
