import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Bypass ngrok free-tier browser interstitial on API calls
  config.headers['ngrok-skip-browser-warning'] = 'true';
  return config;
});

// Track if we're already handling a 401 to avoid multiple redirects
let isRedirecting = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isRedirecting) {
      isRedirecting = true;
      localStorage.removeItem('token');
      // Use a slight delay to let any in-flight requests settle
      setTimeout(() => {
        isRedirecting = false;
      }, 1000);
      // Dispatch a custom event that AuthContext can listen to
      window.dispatchEvent(new Event('auth:expired'));
    }
    return Promise.reject(error);
  }
);

export default api;
