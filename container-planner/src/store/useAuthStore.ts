import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '../types';

interface AuthState {
  role: UserRole;
  setRole: (role: UserRole) => void;
}

/** A lightweight stand-in for real auth: the demo lets the user switch role from the header to
 * see how each screen behaves for Admin / Planner / Viewer. */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      role: 'ADMIN',
      setRole: (role) => set({ role }),
    }),
    { name: 'auth-storage' }
  )
);
