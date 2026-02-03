'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi } from '@/lib/api';

interface User {
  id: string;
  email: string;
  display_name: string | null;
  user_type: 'human' | 'agent';
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'chitin_auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;

    try {
      const userData = await authApi.getMe(token);
      setUser({
        id: userData.id,
        email: userData.email,
        display_name: userData.display_name,
        user_type: userData.user_type as 'human' | 'agent',
      });
    } catch (error) {
      // Token might be invalid
      logout();
    }
  }, [token, logout]);

  const login = useCallback(async (newToken: string) => {
    setToken(newToken);
    localStorage.setItem(TOKEN_KEY, newToken);

    try {
      const userData = await authApi.getMe(newToken);
      setUser({
        id: userData.id,
        email: userData.email,
        display_name: userData.display_name,
        user_type: userData.user_type as 'human' | 'agent',
      });
    } catch (error) {
      logout();
      throw error;
    }
  }, [logout]);

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);

      if (storedToken) {
        try {
          const userData = await authApi.getMe(storedToken);
          setToken(storedToken);
          setUser({
            id: userData.id,
            email: userData.email,
            display_name: userData.display_name,
            user_type: userData.user_type as 'human' | 'agent',
          });
        } catch {
          localStorage.removeItem(TOKEN_KEY);
        }
      }

      setIsLoading(false);
    };

    initAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
