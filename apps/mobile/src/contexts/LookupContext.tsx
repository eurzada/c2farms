import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { File, Paths } from 'expo-file-system/next';
import api from '../services/api';
import { useAuth } from './AuthContext';

export interface Commodity {
  id: string;
  name: string;
  code: string;
  lbs_per_bu: number;
}

export interface Location {
  id: string;
  name: string;
  code: string;
}

export interface Bin {
  id: string;
  bin_number: string;
  location_id: string;
  commodity_id: string | null;
}

export interface Counterparty {
  id: string;
  name: string;
  short_code: string;
}

export interface Contract {
  id: string;
  contract_number: string;
  commodity_id: string;
  counterparty_id: string;
  commodity: { name: string };
  counterparty: { name: string };
}

export interface LookupData {
  commodities: Commodity[];
  locations: Location[];
  bins: Bin[];
  counterparties: Counterparty[];
  contracts: Contract[];
}

interface LookupState extends LookupData {
  loading: boolean;
  loaded: boolean;
  refreshLookups: () => Promise<void>;
  getBinsForLocation: (locationId: string) => Bin[];
  getContractsForCommodity: (commodityId: string) => Contract[];
}

const EMPTY: LookupData = {
  commodities: [],
  locations: [],
  bins: [],
  counterparties: [],
  contracts: [],
};

const CACHE_FILE = new File(Paths.document, 'lookup_cache.json');

const LookupContext = createContext<LookupState>({
  ...EMPTY,
  loading: false,
  loaded: false,
  refreshLookups: async () => {},
  getBinsForLocation: () => [],
  getContractsForCommodity: () => [],
});

function loadCached(): LookupData | null {
  try {
    if (!CACHE_FILE.exists) return null;
    return JSON.parse(CACHE_FILE.text());
  } catch {
    return null;
  }
}

function saveCache(data: LookupData): void {
  try {
    CACHE_FILE.write(JSON.stringify(data));
  } catch {
    // Silently fail — cache is optional
  }
}

export function LookupProvider({ children }: { children: React.ReactNode }) {
  const { farm } = useAuth();
  const [data, setData] = useState<LookupData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refreshLookups = useCallback(async () => {
    if (!farm) return;
    setLoading(true);
    try {
      const res = await api.get(`/farms/${farm.id}/mobile/lookup-data`);
      setData(res.data);
      saveCache(res.data);
      setLoaded(true);
    } catch {
      // If fetch fails, try cached data
      const cached = loadCached();
      if (cached) {
        setData(cached);
        setLoaded(true);
      }
    } finally {
      setLoading(false);
    }
  }, [farm]);

  // Load on mount: try cache first for instant display, then fetch fresh
  useEffect(() => {
    if (!farm) return;
    const cached = loadCached();
    if (cached) {
      setData(cached);
      setLoaded(true);
    }
    refreshLookups();
  }, [farm, refreshLookups]);

  const getBinsForLocation = useCallback(
    (locationId: string) => data.bins.filter((b) => b.location_id === locationId),
    [data.bins],
  );

  const getContractsForCommodity = useCallback(
    (commodityId: string) => data.contracts.filter((c) => c.commodity_id === commodityId),
    [data.contracts],
  );

  return (
    <LookupContext.Provider
      value={{
        ...data,
        loading,
        loaded,
        refreshLookups,
        getBinsForLocation,
        getContractsForCommodity,
      }}
    >
      {children}
    </LookupContext.Provider>
  );
}

export function useLookup() {
  return useContext(LookupContext);
}
