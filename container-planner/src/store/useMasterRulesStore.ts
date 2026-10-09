import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ContainerSpec, CustomerRule, HandlingUnitRule } from '../types';

interface WithId {
  id: string;
}

function makeCrud<T extends WithId>(
  set: (fn: (state: MasterRulesState) => Partial<MasterRulesState>) => void,
  key: keyof MasterRulesState
) {
  const arrayOf = (state: MasterRulesState) => state[key] as unknown as T[];
  return {
    add: (row: T) => set((state) => ({ [key]: [...arrayOf(state), row] }) as Partial<MasterRulesState>),
    update: (id: string, patch: Partial<T>) =>
      set((state) => ({ [key]: arrayOf(state).map((r) => (r.id === id ? { ...r, ...patch } : r)) }) as Partial<MasterRulesState>),
    delete: (id: string) => set((state) => ({ [key]: arrayOf(state).filter((r) => r.id !== id) }) as Partial<MasterRulesState>),
  };
}

interface MasterRulesState {
  customerRules: CustomerRule[];
  containerSpecs: ContainerSpec[];
  handlingUnitRules: HandlingUnitRule[];

  addCustomerRule: (row: CustomerRule) => void;
  updateCustomerRule: (id: string, patch: Partial<CustomerRule>) => void;
  deleteCustomerRule: (id: string) => void;

  addContainerSpec: (row: ContainerSpec) => void;
  updateContainerSpec: (id: string, patch: Partial<ContainerSpec>) => void;
  deleteContainerSpec: (id: string) => void;

  addHandlingUnitRule: (row: HandlingUnitRule) => void;
  updateHandlingUnitRule: (id: string, patch: Partial<HandlingUnitRule>) => void;
  deleteHandlingUnitRule: (id: string) => void;
}

export const useMasterRulesStore = create<MasterRulesState>()(
  persist(
    (set) => {
      const customerRules = makeCrud<CustomerRule>(set, 'customerRules');
      const containerSpecs = makeCrud<ContainerSpec>(set, 'containerSpecs');
      const handlingUnitRules = makeCrud<HandlingUnitRule>(set, 'handlingUnitRules');

      return {
        customerRules: [],
        containerSpecs: [],
        handlingUnitRules: [],

        addCustomerRule: customerRules.add,
        updateCustomerRule: customerRules.update,
        deleteCustomerRule: customerRules.delete,

        addContainerSpec: containerSpecs.add,
        updateContainerSpec: containerSpecs.update,
        deleteContainerSpec: containerSpecs.delete,

        addHandlingUnitRule: handlingUnitRules.add,
        updateHandlingUnitRule: handlingUnitRules.update,
        deleteHandlingUnitRule: handlingUnitRules.delete,
      };
    },
    // v5: bumped to drop the old seeded sample rows (CUST-001 "Sample Customer Inc.") that a v4
    // session may have persisted via the now-removed seedDefaults() — master data is strictly
    // import/admin-entered now, so a leftover sample row must not resurface on load.
    { name: 'master-rules-storage-v5' }
  )
);
