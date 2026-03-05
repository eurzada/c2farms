import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = __DEV__
  ? 'https://noma-unobdurate-lidia.ngrok-free.dev/api'
  : 'https://c2farms.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
});

// Attach JWT to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('jwt');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 (expired token)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('jwt');
      await SecureStore.deleteItemAsync('user');
    }
    return Promise.reject(error);
  },
);

export default api;
export { API_BASE_URL };
