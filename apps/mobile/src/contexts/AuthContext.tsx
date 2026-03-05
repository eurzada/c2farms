import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, getStoredAuth, User, Farm } from '../services/auth';

interface AuthState {
  user: User | null;
  farm: Farm | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  farm: null,
  token: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [farm, setFarm] = useState<Farm | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getStoredAuth();
        if (stored.token && stored.user) {
          setToken(stored.token);
          setUser(stored.user);
          setFarm(stored.farm);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setToken(result.token);
    setUser(result.user);
    if (result.farms?.length > 0) {
      setFarm(result.farms[0]);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setToken(null);
    setUser(null);
    setFarm(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        farm,
        token,
        loading,
        login,
        logout,
        isAuthenticated: !!token && !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
