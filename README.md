Act as a Senior Full-Stack Engineer. Build "Container Planner" — a Container Stuffing & Load
Planning web application — from scratch, exactly as specified below.

## TECH STACK
- React 19 + TypeScript + Vite + Tailwind CSS v4
- Zustand 5 with `persist` middleware for all state (localStorage for config, IndexedDB for the
  imported order dataset — a real extract can be thousands of rows, past localStorage's ~5MB quota)
- SheetJS (`xlsx`) for Excel/CSV parsing, including multi-sheet workbook scanning
- lucide-react for icons
- Vitest available for tests

## WORKFLOW (7 steps + welcome screen, driven by a StepperWizard)
0. Start — welcome screen, role-aware (Viewer sees "View Confirmed Plans", others see "Get Started")
1. Import — upload a SAP/ERP order extract
2. Master Data — Container Specs + Customer Rules (two tabs)
3. Planning — cascading scope filter down to what's being planned
4. Auto-Allocate — run the packing engine, pick a strategy
5. Plan Editor — fine-tune the chosen allocation
6. Admin Review — approve/reject the submitted draft
7. CG & Export — center-of-gravity diagram + dispatch manifest export

Roles: ADMIN, PLANNER, VIEWER, switchable via a header RoleSwitcher.
- Planner lands directly on step 3 (Planning), skipping Import/Master Data entirely — those steps
  are filtered out of the nav, not just disabled.
- Viewer only has access to step 7 (confirmed plans) — everything else is unreachable.
- If a role switch leaves the current step off-limits, bounce to that role's default step.

## NO STATIC/SAMPLE DATA
Master Data (Customer Rules, Container Specs) and the imported order set must NEVER be seeded with
hardcoded sample data on first launch. Everything starts genuinely empty. Populate strictly from
(a) an imported Excel file, or (b) manual entry via "Add Customer Rule" / "Add Container Spec".

## STEP 1 — IMPORT
- Drag-and-drop or click-to-browse upload, accepts .xlsx/.xls/.csv.
- Fuzzy column-header matching: map whatever headers the real export uses (not a fixed template) to
  canonical fields (PO Number, Customer ID/Name, Plant, Ship Window, Country, Port, Material Code,
  Description, Quantity, Carton Qty, Weight, Net Weight, Volume/CBM, VSN No, Customer Product Code,
  Pack Master, Pack Type, Cancel Date, Transport Mode, Container Type, PO Type). Match whole
  word/token-runs within a header (e.g. "Total Gross Weight" matches "weight"), never a mid-word
  fragment (e.g. "Export ID" must not match "port"). When multiple columns could match the same
  field, disfavor per-unit/actual columns ("Pallet GrossWt", "ACT Gr Wt") in favor of "Total ..." or
  plainly-named ones.
- Numeric parsing must strip thousands separators/units before parsing ("17,536" → 17536, not NaN/0).
- Reject the file (PO Number / Material Code required) rather than silently importing garbage.
- A workbook can carry a Customer Rules sheet and/or a Container Specs sheet alongside the order
  data, on separate tabs with their own column shapes — scan every sheet and auto-import any that
  matches:
  - Customer Rules sheet: Customer No, Container Type, PO Type, Max/Min Allowed Weight, Max/Min
    Allowed CBM, Tolerance, PO Split, Priority (Option), Partial Shipment.
  - Container Specs sheet: Type, Internal L/W/H, Max Payload, Max CBM, Tare Weight, Practical Fill %.
  - Normalize Container Type text (20/20GP/20FT→'20', 40/40GP/40FT→'40', 40HC/40HQ→'40 HC', LCL→
    'LCL') and PO Type text (OCEAN→'Ocean', 'OCEAN HEAVY'/'OCEAN HEVY'→'Ocean Heavy', else 'Any')
    through alias tables.
- If no dedicated rules/specs sheet exists but the order rows themselves carry a recognizable
  Container Type (and optionally PO Type) column, auto-draft skeleton Customer Rules rows (one per
  distinct Customer + recognized Container Type) and skeleton Container Specs rows (one per distinct
  recognized type) with identifying fields filled in and numeric limits/dimensions left at 0 —
  flagged downstream with a "Needs Setup" badge. Only recognized type text drafts a row; unrecognized
  text is left alone rather than guessing.
- Auto-skip quantity ≤ 0 rows at allocation time (no prompt needed at import).
- Count (but do not block on) rows with missing/null/0 weight — surfaced again, interactively, on
  the Planning stage (see below), not here.
- Import Status Summary badge: `Total Rows Read: X | Valid Line Items: Y | Skipped (Qty = 0): Z |
  Warnings (Missing Weight): W`.
- Dev-mode DevTools hooks: `window.__RAW_EXCEL_DATA__` (raw JSON pre-filter), `window.__PARSED_EXCEL_DATA__`
  (normalized rows), `window.__SKIPPED_EXCEL_ROWS__` (zero-qty + missing-weight rows), plus
  `console.group('📦 Excel Import Inspection Dashboard')` logging exactly: "1. Raw Excel File Sheet
  JSON", "2. Processed & Normalized PO Lines", "3. Skipped Rows (Qty = 0)", "4. Flagged Rows (Missing
  Weight)".
- On success, commit every imported row to the store immediately (no blocking modal at this stage)
  and advance straight to Master Data (step 2), never anywhere else.
- Re-uploading a file fully replaces prior import state — no stale warnings/highlights carry over.

## STEP 2 — MASTER DATA
Two tabs, both searchable, both with Add/Edit (modal) and Delete:

**Container Specs** — one row per physical container type (`'20' | '40' | '40 HC'` only, no LCL):
type (strict dropdown), internal L/W/H (cm), max payload (kg), max CBM, practical fill % (defaults
to 85 — real stuffing never reaches bare physical volume once pallets/bracing/door clearance are
accounted for), tare weight (kg). Flag duplicate types (ambiguous for lookup elsewhere) with a
warning banner. Search by type.

**Customer Rules** — the only rule tier (no country/standard/effective fallback tiers — a customer
with no row for a given type simply isn't allocatable into it). One row per customer + container
type: Customer No, Customer Name, Container Type (strict dropdown: `20 | 40 | 40 HC | LCL` — LCL is
not physical, it's a customer-scope flag meaning "always consolidate, never book a dedicated
container"), PO Type (strict dropdown: `Ocean | Ocean Heavy | Any`), Maximum/Minimum Allowed Weight,
Maximum/Minimum Allowed CBM, Tolerance %, PO Split (dropdown: `Allowed | Not Allowed`), Priority
Option (strict dropdown: `CBM | Weight | Carton Weight` — drives the allocation engine's fit
strategy, see below), Partial Shipment (dropdown: `Allowed | Not Allowed`). Search by customer name
or ID. Customer ID field in the Add/Edit modal autocompletes against customers found in the imported
order data.

Both tables must visually flag any auto-drafted row that still has zero limits ("Needs Setup" badge
+ tinted row) so the admin knows what to fill in.

## STEP 3 — PLANNING (cascading filter)
Four-level cascade, each level enabled only once the one above has a selection: Customer → Plant →
Ship Window → Port. A fifth, independent PO Numbers multi-select sits alongside the cascade. Prune
stale selections automatically if the underlying data changes.

- Flag any customer with no Customer Rule at all (for any container type) in the current filtered
  scope, with an "Add Rule Now" button that jumps to Master Data pre-filled for that customer
  (Admin only).
- Missing-weight handling (deliberately simple — warning + skip only, nothing else):
  - Gate entirely on an explicit PO Number selection — only check for missing weight among the
    POs the planner has actually picked via the PO Numbers filter, never for every PO broadly
    sitting in the wider customer/plant/ship-window/port scope. This lets the cascade be completed
    smoothly even when some unrelated, unselected PO elsewhere has a data problem.
  - For each affected selected PO: a persistent warning banner listing it with a "Skip PO" button,
    AND a modal (shown one at a time) reading exactly: "There is no weight present for PO
    [PO_NUMBER] (Item: [ITEM_CODE]). Do you want to skip this PO and move forward with the remaining
    POs?" with ONLY a "Skip & Continue" button — no Edit Value, no inline edit, no form to add/create
    data on this screen. Skipping removes that row entirely from the underlying order store so it's
    excluded from everything downstream, not just hidden in this view.
  - "Run Auto-Allocation" stays disabled while any selected PO's missing-weight warning is
    unresolved.

## STEP 4 — AUTO-ALLOCATION ENGINE
`runAutoAllocation(orders, customerRules, containerSpecs) → { strategies, missingRuleOrders, invalidOrders }`

- Zero/negative-quantity orders are pulled out up front as `invalidOrders` (reported, never silently
  dropped).
- Customers with no matching rule for any container type go to `missingRuleOrders`.
- Per customer, pick the smallest container type (by CBM) whose rule can fit the customer's total
  cargo; PO Split / Partial Shipment flags control whether a line can fragment across containers and
  whether more than one container can be opened per customer+type.
- Packing is PO-sequential waterfall-fill: a container stays open absorbing cartons from consecutive
  orders — even across PO boundaries — until full, only then opening a new one. This must match real
  stuffing practice, not a naive bin-packing-from-scratch-per-PO approach.
- `practicalCbmPercent` (default 85%) on each ContainerSpec caps the fill target below the physical
  max, not the physical max itself.
- Three strategies always computed: Balanced Fill (weight-to-volume density sort), Weight-Optimized
  (heaviest-first), Volume-Optimized (bulkiest-first) — each reports its own allocations, LCL
  allocations, unplaced orders, total containers, average utilization %, and bottleneck warnings.
- Priority Option engine (per CustomerRule.priorityOption):
  - `'Weight'`: relax the CBM cap to the container's physical max (ignore the rule's own CBM cap);
    weight is the binding constraint.
  - `'CBM'`: relax the weight cap to the container's physical max; CBM is the binding constraint.
  - `'CartonWeight'`: force heaviest-individual-carton-first packing regardless of the strategy's own
    sort mode, so heavy cartons are always packed low/early.
- Explicit LCL routing: if a customer has an explicit `containerType: 'LCL'` CustomerRule row, prefer
  it over the old min-threshold heuristic — route to LCL whenever total weight/CBM falls at or under
  that LCL rule's own max thresholds. Customers with ONLY an LCL rule (no physical-type rule at all)
  must still appear in every strategy's LCL allocations — never silently dropped.
- Bottleneck warning when cargo density sits within 10% of a rule's own weight/CBM limit ratio (both
  dimensions binding, little slack). Guard any such ratio calc against division by zero in an LCL-only
  context.
- UI: expandable per-container detail cards (PO Number, Material, Description, PO Qty, Carton Qty,
  Weight, Net Weight, VSN No, Customer Product Code, Pack Master, Pack Type per item), status badges
  (OK / MICRO_OVERRUN / OVER_LIMIT / MISSING_RULE).

## STEP 5 — PLAN EDITOR
Edit the chosen strategy's container allocations before submitting for Admin Review.

## STEP 6 — ADMIN REVIEW
Approve or reject a submitted draft plan; approval promotes it to a confirmed plan.

## STEP 7 — CG & EXPORT
2D center-of-gravity/balance diagram per container, and a dispatch manifest export matching the
company's real reference export format exactly (column order, number formatting).

## STATE (Zustand, persisted, versioned storage keys — bump the version on any breaking schema change)
- `useRawOrdersStore` (IndexedDB): the full imported order set, `setRawImportedRows`, `removeRows(ids)`
  (used by the Planning-stage skip action), `clear`.
- `useMasterRulesStore` (localStorage): `customerRules`, `containerSpecs`, `handlingUnitRules` + CRUD
  actions for each. No seeding/sample-data action of any kind.
- `useFilterStore`: the five cascade/PO selections + `applyFilters`/`distinctValues` helpers.
- `usePlanStore`: draft plans + confirmed plans.
- `useAuthStore`: current role.

## VERIFICATION
Run `npx tsc -p tsconfig.app.json --noEmit` and `npx vite build` after every change — both must be
clean. For engine logic (priority-option fit behavior, LCL routing, waterfall-fill packing), validate
with a temporary scripted diagnostic (`npm install -D tsx --no-save`, write and run a throwaway
`tsx` script against synthetic and/or real reference data, then delete the script and
`npm uninstall tsx`) rather than trusting a visual check alone.


One honest caveat: this prompt documents behavior, not literal file-by-file source — handing it to a fresh session would get you a functionally equivalent app, but the exact file layout, variable names, and internal helper structure would come out differently each time. If you want the actual current source reproduced verbatim, that's a different ask (e.g. zipping/exporting this working directory) rather than a prompt. 
