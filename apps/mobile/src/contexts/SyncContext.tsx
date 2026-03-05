import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getQueueStats, syncAll, cleanSynced } from '../services/sync';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

interface SyncState {
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  isSyncing: boolean;
  triggerSync: () => Promise<void>;
  refreshStats: () => Promise<void>;
}

const SyncContext = createContext<SyncState>({
  pending: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  isSyncing: false,
  triggerSync: async () => {},
  refreshStats: async () => {},
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState({ pending: 0, syncing: 0, synced: 0, failed: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const isOnline = useNetworkStatus();
  const syncingRef = useRef(false);

  const refreshStats = useCallback(async () => {
    const s = await getQueueStats();
    setStats(s);
  }, []);

  const triggerSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);

    try {
      await syncAll();
      await cleanSynced();
      await refreshStats();
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [refreshStats]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline) {
      triggerSync();
    }
  }, [isOnline, triggerSync]);

  // Refresh stats on mount
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  return (
    <SyncContext.Provider
      value={{ ...stats, isSyncing, triggerSync, refreshStats }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
