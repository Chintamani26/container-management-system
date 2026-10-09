import { useAuthStore } from '../../store/useAuthStore';
import type { UserRole } from '../../types';

const ROLES: UserRole[] = ['ADMIN', 'PLANNER', 'VIEWER'];

/** Stands in for real auth — lets the demo show how each screen behaves for every role without a
 * login flow. */
export function RoleSwitcher() {
  const role = useAuthStore((s) => s.role);
  const setRole = useAuthStore((s) => s.setRole);

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Role
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as UserRole)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r.charAt(0) + r.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

export default RoleSwitcher;
