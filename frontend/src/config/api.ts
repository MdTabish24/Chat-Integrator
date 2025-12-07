import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (typeof window !== 'undefined' && window.location.origin) || 
  'http://localhost:8000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 180000, // 180 seconds (3 min) - needed for Twitter rate limiting + Telegram DC migration
});

// Lock to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const subscribeTokenRefresh = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb);
};

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
};

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token && !config.url?.includes('/auth/refresh')) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl = originalRequest?.url || '';

    // Skip token refresh for platform-specific endpoints
    // These endpoints might return 401/403 for platform cookie expiry, not JWT expiry
    const platformEndpoints = [
      '/api/platforms/',
      '/api/oauth/',
      '/api/webhooks/',
      '/linkedin',
      '/twitter',
      '/instagram',
      '/facebook',
      '/whatsapp',
      '/discord',
      '/telegram',
    ];
    
    const isPlatformRequest = platformEndpoints.some(endpoint => requestUrl.includes(endpoint));
    
    // Only try to refresh token for auth-related endpoints or if explicitly needed
    const isAuthEndpoint = requestUrl.includes('/api/auth/') || requestUrl.includes('/api/messages') || requestUrl.includes('/api/conversations');
    
    // If platform request returns 401/403, it's likely platform cookies expired, not JWT
    // Don't redirect to login, just reject the error for the component to handle
    if (isPlatformRequest && (error.response?.status === 401 || error.response?.status === 403)) {
      console.log('[API] Platform auth error - not redirecting to login:', requestUrl);
      return Promise.reject(error);
    }

    // If token expired (401 or 403) for auth endpoints, try to refresh
    if ((error.response?.status === 401 || error.response?.status === 403) && !originalRequest._retry && isAuthEndpoint) {
      
      // If already refreshing, wait for the refresh to complete
      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }
      
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
          refreshToken,
        });

        // IMPORTANT: Save BOTH tokens - refresh tokens are rotated!
        const { accessToken, refreshToken: newRefreshToken } = response.data.tokens || response.data;
        localStorage.setItem('access_token', accessToken);
        if (newRefreshToken) {
          localStorage.setItem('refresh_token', newRefreshToken);
          console.log('[API] Tokens refreshed successfully');
        }

        isRefreshing = false;
        onTokenRefreshed(accessToken);
        
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];
        
        // Only redirect to login if refresh actually failed
        // And only if we're not already on login page
        console.log('[API] Token refresh failed, clearing session');
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        
        // Force redirect to login only if we're on a protected page
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
