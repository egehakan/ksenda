/**
 * Server-side guard for a multi-country "DAILY" recipe's filters.
 *
 * A DAILY recipe stores { multiLeg: true, legs: [{ country, cap, rotate }] }.
 * The CLI orchestrator (automation/lib/plan-core.cjs) silently DROPS a leg with
 * an empty `rotate` list and treats a zero-leg recipe as non-multiLeg — both
 * yield a recipe that looks saved but does nothing. Reject those here so the
 * frontend (or a direct API call) can never persist a structurally-broken plan.
 *
 * Returns an error string, or null when the filters are valid (or not a
 * multiLeg recipe at all — normal Apollo filters pass straight through).
 */
export function validateMultiLegFilters(filters: unknown): string | null {
  if (!filters || typeof filters !== "object") return null;
  const f = filters as { multiLeg?: unknown; legs?: unknown };
  if (f.multiLeg !== true) return null;
  if (!Array.isArray(f.legs) || f.legs.length === 0) {
    return "A multi-country recipe needs at least one country (leg).";
  }
  for (const raw of f.legs) {
    const lg = (raw ?? {}) as { country?: unknown; rotate?: unknown };
    if (!Array.isArray(lg.rotate) || lg.rotate.length === 0) {
      const name =
        typeof lg.country === "string" && lg.country ? lg.country : "Each country";
      return `${name} needs at least one industry recipe code in rotate[].`;
    }
  }
  return null;
}
