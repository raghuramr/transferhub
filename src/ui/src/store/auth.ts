import { create } from 'zustand';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  updateUser: (partial: Partial<User>) => void;
  clearAuth: () => void;
  initFromStorage: () => void;
}

/**
 * Reads the saved session once, synchronously, when the store is created. Restoring it in an effect
 * (after the first render) made every route guard see "logged out" on a page refresh and redirect to /login.
 */
function loadStoredSession(): Pick<AuthState, 'user' | 'accessToken' | 'isAuthenticated'> {
  try {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      return { user: JSON.parse(userStr) as User, accessToken: token, isAuthenticated: true };
    }
  } catch {
    // corrupted storage - start logged out
  }
  return { user: null, accessToken: null, isAuthenticated: false };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...loadStoredSession(),

  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, accessToken, isAuthenticated: true });
  },

  updateUser: (partial) => {
    set((state) => {
      if (!state.user) return state;
      const user = { ...state.user, ...partial };
      localStorage.setItem('user', JSON.stringify(user));
      return { user };
    });
  },

  clearAuth: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  initFromStorage: () => {
    try {
      const token = localStorage.getItem('accessToken');
      const userStr = localStorage.getItem('user');
      if (token && userStr) {
        const user = JSON.parse(userStr) as User;
        set({ user, accessToken: token, isAuthenticated: true });
      }
    } catch {
      // corrupted storage — stay logged out
    }
  },
}));
