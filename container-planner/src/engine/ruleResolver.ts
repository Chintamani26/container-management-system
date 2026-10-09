import type { ContainerSpec, ContainerType, CustomerRule, SAPOrderRow } from '../types';

/**
 * Finds the one rule row for this customer + container type. Country/standard fallback tiers
 * were removed — a customer with no row for a given type simply can't be allocated into it (a
 * MISSING_RULE case), never silently guessed at.
 */
export function resolveRule(
  order: Pick<SAPOrderRow, 'customerId'>,
  containerType: ContainerType,
  customerRules: CustomerRule[]
): CustomerRule | undefined {
  return customerRules.find((r) => r.customerId === order.customerId && r.containerType === containerType);
}

/** The first spec per type with a usable (non-zero) capacity wins — guards against a blank row
 * left over from "Add Container Spec" (defaults every dimension to 0) silently shadowing the real
 * spec for that type wherever specs get looked up by type (CG/export, the allocator). */
export function dedupeValidSpecs(containerSpecs: ContainerSpec[]): ContainerSpec[] {
  const byType = new Map<string, ContainerSpec>();
  for (const spec of containerSpecs) {
    const existing = byType.get(spec.type);
    const isUsable = spec.maxCbm > 0 && spec.maxPayloadKg > 0 && spec.internalLengthCm > 0;
    const existingUsable = existing ? existing.maxCbm > 0 && existing.maxPayloadKg > 0 && existing.internalLengthCm > 0 : false;
    if (!existing || (!existingUsable && isUsable)) byType.set(spec.type, spec);
  }
  return [...byType.values()];
}

/** Looks up one container spec by type, preferring a usable (non-zero) one if duplicates exist. */
export function findSpecByType(containerSpecs: ContainerSpec[], type: string): ContainerSpec | undefined {
  return dedupeValidSpecs(containerSpecs).find((s) => s.type === type);
}
