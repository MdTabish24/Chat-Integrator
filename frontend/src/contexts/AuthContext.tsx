import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import apiClient from '../config/api';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in
    const initAuth = async () => {
      const token = localStorage.getItem('access_token');
      if (token) {
        try {
          const response = await apiClient.get('/api/auth/me');
          setUser(response.data);
        } catch (error: any) {
          console.log('[Auth] Init auth error:', error?.response?.status, error?.message);
          
          // Only clear tokens if it's definitely an auth error (401)
          // Don't clear for network errors, timeouts, or server errors
          if (error?.response?.status === 401) {
            // Try to refresh token before giving up
            const refreshToken = localStorage.getItem('refresh_token');
            if (refreshToken) {
              try {
                const refreshResponse = await apiClient.post('/api/auth/refresh', { refreshToken });
                const { accessToken } = refreshResponse.data;
                localStorage.setItem('access_token', accessToken);
                
                // Retry getting user with new token
                const retryResponse = await apiClient.get('/api/auth/me');
                setUser(retryResponse.data);
              } catch (refreshError) {
                console.log('[Auth] Refresh failed, clearing tokens');
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
              }
            } else {
              localStorage.removeItem('access_token');
              localStorage.removeItem('refresh_token');
            }
          } else {
            // For network errors or server errors, keep the token and set user as null
            // The user can try again or the app will retry later
            console.log('[Auth] Non-401 error during init, keeping token');
            // Try to create a basic user object from the token
            try {
              const tokenParts = token.split('.');
              if (tokenParts.length === 3) {
                const payload = JSON.parse(atob(tokenParts[1]));
                setUser({ id: payload.user_id || payload.sub, email: payload.email || '' });
              }
            } catch (e) {
              // Token parsing failed, but don't clear it
            }
          }
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await apiClient.post('/api/auth/login', { email, password });
    const { tokens, user: userData } = response.data;
    
    localStorage.setItem('access_token', tokens.accessToken);
    localStorage.setItem('refresh_token', tokens.refreshToken);
    setUser(userData);
  };

  const register = async (email: string, password: string) => {
    const response = await apiClient.post('/api/auth/register', { email, password });
    const { tokens, user: userData } = response.data;
    
    localStorage.setItem('access_token', tokens.accessToken);
    localStorage.setItem('refresh_token', tokens.refreshToken);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  };

  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
