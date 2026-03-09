import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';

const FarmContext = createContext(null);

const ENTERPRISE_ID = '__enterprise__';
const DEFAULT_MODULES = ['forecast', 'inventory', 'marketing', 'logistics', 'agronomy', 'enterprise'];

export function FarmProvider({ children }) {
  const { user, farms: authFarms, refreshAuthFarms } = useAuth();
  const [selectedId, setSelectedId] = useState(null); // can be ENTERPRISE_ID or a real farm id
  const [fiscalYear, setFiscalYear] = useState(() => {
    const now = new Date();
    return now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear();
  });

  const isEnterprise = selectedId === ENTERPRISE_ID;

  // Find the real Enterprise farm record from the DB (has is_enterprise flag)
  const enterpriseFarm = useMemo(() => {
    return authFarms?.find(f => f.is_enterprise) || null;
  }, [authFarms]);

  // The real farm used for API calls
  const currentFarm = useMemo(() => {
    if (!authFarms?.length) return null;
    if (isEnterprise) {
      // Use the dedicated Enterprise farm for API calls
      return enterpriseFarm || authFarms[0];
    }
    return authFarms.find(f => f.id === selectedId) || authFarms[0];
  }, [authFarms, selectedId, isEnterprise, enterpriseFarm]);

  // Build dropdown list: Enterprise + individual BU farms (exclude Enterprise farm record from BU list)
  const allFarms = useMemo(() => {
    if (!authFarms?.length) return [];
    const buFarms = authFarms.filter(f => !f.is_enterprise);
    return [
      { id: ENTERPRISE_ID, name: 'C2 Farms Enterprise', role: 'admin' },
      ...buFarms,
    ];
  }, [authFarms]);

  // Role-derived values
  const currentRole = isEnterprise ? 'admin' : (currentFarm?.role || 'viewer');
  const isAdmin = currentRole === 'admin';
  const canEdit = !isEnterprise ? (currentRole === 'admin' || currentRole === 'manager') : true;

  // Module visibility from user's global modules setting
  const modules = user?.modules || DEFAULT_MODULES;
  const hasModule = useCallback((mod) => modules.includes(mod), [modules]);

  // Wrapper for setCurrentFarm that accepts a farm object (from dropdown)
  const setCurrentFarm = useCallback((farm) => {
    if (farm?.id) setSelectedId(farm.id);
  }, []);

  // Initialize from localStorage
  useEffect(() => {
    if (!user || !authFarms?.length) {
      setSelectedId(null);
      return;
    }
    const saved = localStorage.getItem('c2farms_currentFarmId');
    if (saved === ENTERPRISE_ID) {
      setSelectedId(ENTERPRISE_ID);
    } else if (saved && authFarms.find(f => f.id === saved)) {
      setSelectedId(saved);
    } else {
      setSelectedId(ENTERPRISE_ID); // Default to enterprise view
    }
  }, [user, authFarms]);

  // Persist to localStorage
  useEffect(() => {
    if (selectedId) {
      localStorage.setItem('c2farms_currentFarmId', selectedId);
    }
  }, [selectedId]);

  const refreshFarms = useCallback(async () => {
    const newFarms = await refreshAuthFarms();
    setSelectedId(prev => {
      if (prev === ENTERPRISE_ID) return ENTERPRISE_ID;
      if (!prev || !newFarms.find(f => f.id === prev)) return ENTERPRISE_ID;
      return prev;
    });
  }, [refreshAuthFarms]);

  // All individual BU farms (for rollup queries — excludes Enterprise farm)
  const farmUnits = useMemo(() => {
    return authFarms?.filter(f => !f.is_enterprise) || [];
  }, [authFarms]);

  const value = useMemo(() => ({
    farms: allFarms, farmUnits, currentFarm, setCurrentFarm,
    fiscalYear, setFiscalYear, refreshFarms,
    currentRole, isAdmin, canEdit, modules, hasModule,
    isEnterprise, selectedId,
  }), [allFarms, farmUnits, currentFarm, setCurrentFarm,
       fiscalYear, refreshFarms,
       currentRole, isAdmin, canEdit, modules, hasModule,
       isEnterprise, selectedId]);

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

export { ENTERPRISE_ID };
