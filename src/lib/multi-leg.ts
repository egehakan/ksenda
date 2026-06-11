/**
 * Multi-leg "DAILY" recipe helpers (frontend).
 *
 * A normal recipe is one Apollo search. A multi-country DAILY recipe instead
 * carries no Apollo filters of its own — its filtersJson is:
 *   { multiLeg: true, totalCap: 20, legs: [ { country, key, cap, rotate } ] }
 * and the CLI orchestrator (/run-today-automation) expands it into one LEG per
 * country each day, picking that day's industry recipe from `rotate` by date.
 *
 * The frontend never RUNS this — it only visualizes/edits it. These helpers
 * mirror the server-side expansion (automation/lib/plan-core.cjs) so the UI can
 * show exactly which single-industry recipe each country will use on a date.
 */

export interface RecipeLeg {
  /** Display country, e.g. "Germany". */
  country?: string;
  /** Short, stable key used for leg ids / flags, e.g. "DE". */
  key?: string;
  /** Per-country daily cap. */
  cap: number;
  /** Single-industry recipe codes rotated one-per-day, e.g. ["DE1".."DE6"]. */
  rotate: string[];
}

export interface MultiLegPlan {
  legs: RecipeLeg[];
  /** Sum of leg caps (the account's per-day total), or the recipe's totalCap. */
  totalCap: number;
}

/**
 * Parse a recipe's filters into a multi-leg plan, or null when it isn't a
 * multiLeg recipe. Accepts either a parsed filters object (recipes API) or a
 * raw filtersJson string (schedule API embeds the raw SavedSearch).
 */
export function parseMultiLeg(
  input: Record<string, unknown> | string | null | undefined
): MultiLegPlan | null {
  if (!input) return null;
  let obj: Record<string, unknown> | null = null;
  if (typeof input === "string") {
    try {
      obj = JSON.parse(input) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    obj = input;
  }
  if (!obj || obj.multiLeg !== true || !Array.isArray(obj.legs)) return null;

  const legs: RecipeLeg[] = (obj.legs as unknown[])
    .map((raw) => {
      const l = (raw ?? {}) as Record<string, unknown>;
      return {
        country: typeof l.country === "string" ? l.country : undefined,
        key: typeof l.key === "string" ? l.key : undefined,
        cap:
          typeof l.cap === "number"
            ? l.cap
            : Number.isFinite(Number(l.cap))
              ? Number(l.cap)
              : 0,
        rotate: Array.isArray(l.rotate)
          ? (l.rotate as unknown[]).filter(
              (x): x is string => typeof x === "string"
            )
          : [],
      };
    });
  const totalCap =
    typeof obj.totalCap === "number"
      ? obj.totalCap
      : legs.reduce((s, l) => s + (l.cap || 0), 0);
  return { legs, totalCap };
}

/** True when these filters describe a multi-leg DAILY recipe. */
export function isMultiLegFilters(
  input: Record<string, unknown> | string | null | undefined
): boolean {
  return parseMultiLeg(input) !== null;
}

/**
 * Deterministic industry rotation for a date — MUST match
 * automation/lib/plan-core.cjs `rotationIndex` (UTC day ordinal % modulo,
 * normalised positive) so the UI shows the same industry the run will use.
 */
export function rotationIndex(dateKey: string, modulo: number): number {
  if (!modulo || modulo < 1) return 0;
  // Identical math to automation/lib/plan-core.cjs rotationIndex — do not add
  // fallbacks here or the UI's "today's industry" can drift from the run.
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const ord = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return ((ord % modulo) + modulo) % modulo;
}

/** The single-industry recipe code a leg will use on `dateKey` (or null). */
export function legIndustryCode(leg: RecipeLeg, dateKey: string): string | null {
  if (!leg.rotate || leg.rotate.length === 0) return null;
  return leg.rotate[rotationIndex(dateKey, leg.rotate.length)] ?? null;
}

/** Short, stable label for a leg: explicit key, else the rotate-code prefix,
 *  else the country, else "?". */
export function legShort(leg: RecipeLeg): string {
  if (leg.key) return leg.key.toUpperCase();
  const code = leg.rotate?.[0];
  if (code) {
    const prefix = code.toUpperCase().replace(/\d+$/, "");
    if (prefix) return prefix;
  }
  return (leg.country || "?").slice(0, 3).toUpperCase();
}

// Map the few non-ISO leg keys / country names we use to an ISO-3166 alpha-2
// code, then turn that into a flag emoji via regional-indicator code points.
const KEY_TO_ISO: Record<string, string> = { UK: "GB" };
const COUNTRY_TO_ISO: Record<string, string> = {
  turkey: "TR",
  türkiye: "TR",
  germany: "DE",
  "united arab emirates": "AE",
  uae: "AE",
  switzerland: "CH",
  canada: "CA",
  ireland: "IE",
  bahrain: "BH",
  "united states": "US",
  "united kingdom": "GB",
  france: "FR",
  netherlands: "NL",
  spain: "ES",
  austria: "AT",
  qatar: "QA",
  "saudi arabia": "SA",
  kuwait: "KW",
  oman: "OM",
};

function isoForLeg(leg: RecipeLeg): string | null {
  const k = (leg.key || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(k)) return KEY_TO_ISO[k] || k;
  const code = (leg.rotate?.[0] || "").toUpperCase().replace(/\d+$/, "");
  if (/^[A-Z]{2}$/.test(code)) return KEY_TO_ISO[code] || code;
  const byName = COUNTRY_TO_ISO[(leg.country || "").trim().toLowerCase()];
  return byName || null;
}

/** Flag emoji for a leg's country, or a globe fallback. */
export function legFlag(leg: RecipeLeg): string {
  const iso = isoForLeg(leg);
  if (!iso || !/^[A-Z]{2}$/.test(iso)) return "🌐";
  return iso.replace(/./g, (c) =>
    String.fromCodePoint(127397 + c.charCodeAt(0))
  );
}

/** Human label for a leg, e.g. "Germany" (falls back to the short key). */
export function legCountryLabel(leg: RecipeLeg): string {
  return leg.country || legShort(leg);
}
