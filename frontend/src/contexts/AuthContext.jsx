import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { disconnectSocket } from '../services/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/api/auth/me')
        .then(res => {
          setUser(res.data.user);
          setFarms(res.data.farms || []);
        })
        .catch(() => {
          localStorage.removeItem('token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Listen for 401 auth expired events from the API interceptor
  useEffect(() => {
    const handleExpired = () => {
      disconnectSocket();
      setUser(null);
      setFarms([]);
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/api/auth/login', { email, password });
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    // Fetch farms after login
    try {
      const meRes = await api.get('/api/auth/me');
      setFarms(meRes.data.farms || []);
    } catch { /* farms will load via FarmContext */ }
    return res.data;
  };

  const register = async (email, password, name) => {
    const res = await api.post('/api/auth/register', { email, password, name });
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    disconnectSocket();
    setUser(null);
    setFarms([]);
  };

  const refreshAuthFarms = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      setFarms(res.data.farms || []);
      return res.data.farms || [];
    } catch {
      return farms;
    }
  }, [farms]);

  return (
    <AuthContext.Provider value={{ user, farms, loading, login, register, logout, refreshAuthFarms }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
