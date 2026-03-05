import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';

const FarmContext = createContext(null);

const ENTERPRISE_ID = '__enterprise__';
const ENTERPRISE_MODULES = ['marketing', 'logistics', 'inventory', 'forecast', 'agronomy'];
const FARM_UNIT_MODULES = ['forecast', 'agronomy', 'inventory'];

export function FarmProvider({ children }) {
  const { user, farms: authFarms, refreshAuthFarms } = useAuth();
  const [selectedId, setSelectedId] = useState(null); // can be ENTERPRISE_ID or a real farm id
  const [fiscalYear, setFiscalYear] = useState(() => {
    const now = new Date();
    return now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear();
  });

  const isEnterprise = selectedId === ENTERPRISE_ID;

  // The real farm used for API calls (first farm when enterprise, selected farm otherwise)
  const currentFarm = useMemo(() => {
    if (!authFarms?.length) return null;
    if (isEnterprise) {
      // Return first farm but with enterprise flag for API calls
      return authFarms[0];
    }
    return authFarms.find(f => f.id === selectedId) || authFarms[0];
  }, [authFarms, selectedId, isEnterprise]);

  // Build dropdown list: Enterprise + individual farms
  const allFarms = useMemo(() => {
    if (!authFarms?.length) return [];
    return [
      { id: ENTERPRISE_ID, name: 'C2 Farms Enterprise', role: 'admin' },
      ...authFarms,
    ];
  }, [authFarms]);

  // Role-derived values
  const currentRole = isEnterprise ? 'admin' : (currentFarm?.role || 'viewer');
  const isAdmin = currentRole === 'admin';
  const canEdit = !isEnterprise ? (currentRole === 'admin' || currentRole === 'manager') : true;

  // Module visibility depends on enterprise vs farm-unit mode
  const modules = isEnterprise ? ENTERPRISE_MODULES : FARM_UNIT_MODULES;
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

  // All individual farms (for rollup queries)
  const farmUnits = authFarms;

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
