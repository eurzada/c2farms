import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';

const FarmContext = createContext(null);

export function FarmProvider({ children }) {
  const { user, farms: authFarms, refreshAuthFarms } = useAuth();
  const [currentFarm, setCurrentFarm] = useState(null);
  const [fiscalYear, setFiscalYear] = useState(() => {
    // Default to current fiscal year (Nov-Oct: Nov/Dec = next FY)
    const now = new Date();
    return now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear();
  });

  // Role-derived values
  const currentRole = currentFarm?.role || 'viewer';
  const isAdmin = currentRole === 'admin';
  const canEdit = currentRole === 'admin' || currentRole === 'manager';

  // Initialize current farm from authFarms, respecting localStorage persistence
  useEffect(() => {
    if (!user || authFarms.length === 0) {
      setCurrentFarm(null);
      return;
    }

    const savedFarmId = localStorage.getItem('c2farms_currentFarmId');
    const savedFarm = savedFarmId ? authFarms.find(f => f.id === savedFarmId) : null;

    if (savedFarm) {
      setCurrentFarm(savedFarm);
    } else if (!currentFarm || !authFarms.find(f => f.id === currentFarm.id)) {
      setCurrentFarm(authFarms[0]);
    } else {
      // Update current farm data (e.g. name change) from fresh farms list
      const updated = authFarms.find(f => f.id === currentFarm.id);
      if (updated) setCurrentFarm(updated);
    }
  }, [user, authFarms]);

  // Persist selected farm to localStorage
  useEffect(() => {
    if (currentFarm?.id) {
      localStorage.setItem('c2farms_currentFarmId', currentFarm.id);
    }
  }, [currentFarm?.id]);

  const refreshFarms = useCallback(async () => {
    const newFarms = await refreshAuthFarms();
    // After refresh, if current farm was deleted, auto-select first
    setCurrentFarm(prev => {
      if (!prev || !newFarms.find(f => f.id === prev.id)) {
        return newFarms[0] || null;
      }
      return newFarms.find(f => f.id === prev.id) || prev;
    });
  }, [refreshAuthFarms]);

  const value = useMemo(() => ({
    farms: authFarms, currentFarm, setCurrentFarm, fiscalYear, setFiscalYear, refreshFarms,
    currentRole, isAdmin, canEdit,
  }), [authFarms, currentFarm, fiscalYear, refreshFarms, currentRole, isAdmin, canEdit]);

  return (
    <FarmContext.Provider value={value}>
      {children}
    </FarmContext.Provider>
  );
}

export function useFarm() {
  const ctx = useContext(FarmContext);
  if (!ctx) throw new Error('useFarm must be used within FarmProvider');
  return ctx;
}
