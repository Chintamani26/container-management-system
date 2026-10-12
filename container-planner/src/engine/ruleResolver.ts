import type { ContainerSpec, ContainerType, CustomerRule, SAPOrderRow } from '../types';

/** Normalizes a Customer No for matching — trims whitespace, lowercases, and strips leading zeros
 * (e.g. "0000200911" and "200911" must match the same rule; an Excel import routinely drops or
 * keeps zero-padding inconsistently between the order sheet and a rules sheet/manual entry). Never
 * strips every character — an all-zero id like "0" stays "0" rather than collapsing to "". */
export function normalizeCustomerId(id: string | null | undefined): string {
  return (id ?? '').trim().toLowerCase().replace(/^0+(?=.)/, '');
}

/** Normalizes a Container Type for matching — trims whitespace and uppercases, so "40hc", "40 HC"
 * and " 40 HC " all compare equal. Collapses internal whitespace runs too (SAP exports sometimes
 * carry a double space). */
export function normalizeContainerType(type: string | null | undefined): string {
  return (type ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Finds the one rule row for this customer + container type. Country/standard fallback tiers
 * were removed — a customer with no row for a given type simply can't be allocated into it (a
 * MISSING_RULE case), never silently guessed at. Matching is case/whitespace/leading-zero
 * insensitive (see normalizeCustomerId/normalizeContainerType) so formatting differences between
 * the order extract and the rules table never cause a real match to be missed.
 */
export function resolveRule(
  order: Pick<SAPOrderRow, 'customerId' | 'poType'>,
  containerType: ContainerType,
  customerRules: CustomerRule[]
): CustomerRule | undefined {
  const matchedRule = customerRules.find(
    (r) => normalizeCustomerId(r.customerId) === normalizeCustomerId(order.customerId) && normalizeContainerType(r.containerType) === normalizeContainerType(containerType)
  );

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.group(`🔍 Rule Resolver Audit for Customer: ${order.customerId}`);
    console.log('Order Line Customer ID:', order.customerId, '-> Normalized:', normalizeCustomerId(order.customerId));
    // PO Type is NOT a matching criterion — a rule's own PO Type field is informational only and
    // never filters resolveRule's result, so a blank/mismatched PO Type on the order line can never
    // be the cause of a "no rule found" result. Logged here only for visibility, not as a factor.
    console.log('Order Line PO Type (not used for matching):', order.poType);
    console.log('Requested Container Type:', containerType, '-> Normalized:', normalizeContainerType(containerType));
    console.log('Available Customer Rules in Store:', customerRules);
    console.log('Matched Rule Result:', matchedRule);
    console.groupEnd();
  }

  return matchedRule;
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
