import { useEffect, useState } from 'react';
import { Container, Wifi, WifiOff } from 'lucide-react';
import { RoleSwitcher } from './RoleSwitcher';

export interface HeaderProps {
  /** The draft or confirmed plan currently active, e.g. "DRAFT-1505" or "PLN-1505". */
  activePlanId?: string | null;
}

/** Tracks the browser's connectivity. This app runs fully client-side against mock data, so
 * "offline" here means no network, not an API outage. */
function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

export function Header({ activePlanId }: HeaderProps) {
  const isOnline = useIsOnline();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <Container className="h-6 w-6 text-indigo-600" aria-hidden="true" />
        <span className="text-lg font-semibold text-slate-900">Container Planner</span>

        {activePlanId && (
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
            {activePlanId}
          </span>
        )}

        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
            isOnline ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
          }`}
          title={isOnline ? 'Connected' : 'No network connection — working from local data'}
        >
          {isOnline ? <Wifi className="h-3.5 w-3.5" aria-hidden="true" /> : <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />}
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      <RoleSwitcher />
    </header>
  );
}

export default Header;
