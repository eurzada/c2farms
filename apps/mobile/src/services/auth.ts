import * as SecureStore from 'expo-secure-store';
import api from './api';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Farm {
  id: string;
  name: string;
  role: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  farms: Farm[];
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  // Step 1: Login to get token + user
  const { data } = await api.post('/auth/login', { email, password });
  await SecureStore.setItemAsync('jwt', data.token);
  await SecureStore.setItemAsync('user', JSON.stringify(data.user));

  // Step 2: Fetch farms via /auth/me (login doesn't return farms)
  let farms: Farm[] = [];
  try {
    const meRes = await api.get('/auth/me');
    farms = meRes.data.farms || [];
  } catch {
    // Fall back gracefully
  }

  if (farms.length > 0) {
    await SecureStore.setItemAsync('farm', JSON.stringify(farms[0]));
  }

  return { token: data.token, user: data.user, farms };
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync('jwt');
  await SecureStore.deleteItemAsync('user');
  await SecureStore.deleteItemAsync('farm');
}

export async function getStoredAuth(): Promise<{ token: string | null; user: User | null; farm: Farm | null }> {
  const token = await SecureStore.getItemAsync('jwt');
  const userStr = await SecureStore.getItemAsync('user');
  const farmStr = await SecureStore.getItemAsync('farm');
  return {
    token,
    user: userStr ? JSON.parse(userStr) : null,
    farm: farmStr ? JSON.parse(farmStr) : null,
  };
}
