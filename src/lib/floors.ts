/* ─────────────── Floor plan: single source of truth ───────────────
 *
 * Thalassa dining sections and their real table numbers. Everything that
 * needs to know about floors/tables (the floor plan panel, the reservation
 * modals, and the GHL calendar parser) imports from here.
 */

export type FloorType = "main" | "terrace" | "lounge" | "outdoor";

/** Display order for the floor tabs / dropdowns. */
export const FLOOR_ORDER: FloorType[] = ["main", "terrace", "lounge", "outdoor"];

export const FLOOR_LABEL: Record<FloorType, string> = {
  main: "Main Floor",
  terrace: "Terrace",
  lounge: "Lounge",
  outdoor: "Outdoor",
};

const numRange = (start: number, end: number, skip: number[] = []) =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i)
    .filter((n) => !skip.includes(n))
    .map(String);

export const FLOOR_TABLES: Record<FloorType, string[]> = {
  main: numRange(1, 15, [13]),
  terrace: numRange(17, 31),
  lounge: numRange(34, 40),
  outdoor: [1, 2, 3, 4, 5, 6, 200, 201, 202, 203, 204, 205].map((n) => `Out.${n}`),
};

/** Free-text "Floor : ..." values (lower-cased) coming back from GHL. */
export const FLOOR_MAP: Record<string, FloorType> = {
  "main floor": "main",
  main: "main",
  terrace: "terrace",
  lounge: "lounge",
  outdoor: "outdoor",
  // legacy value still present on older appointments
  balcony: "outdoor",
};

/**
 * Normalise one raw table token from GHL appointment text to its canonical id
 * for `floor`, or `null` if it is not a real table on that floor.
 *
 * Accepts the canonical form ("14", "Out.200"), a legacy "TABLE." prefix
 * ("TABLE.14"), and loose outdoor spellings ("Out 200", "o200", "200").
 */
export function normalizeTable(raw: string, floor: FloorType): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const candidates = [cleaned, cleaned.replace(/^(table|t)[\s.]*/i, "")];
  for (const candidate of candidates) {
    const hit = FLOOR_TABLES[floor].find(
      (t) => t.toLowerCase() === candidate.toLowerCase(),
    );
    if (hit) return hit;
  }

  if (floor === "outdoor") {
    const digits = cleaned.match(/(\d+)\s*$/)?.[1];
    if (digits) {
      const hit = FLOOR_TABLES.outdoor.find((t) => t === `Out.${Number(digits)}`);
      if (hit) return hit;
    }
  }

  return null;
}

/** Sort table ids numerically by their trailing digits ("Out.6" before "Out.200"). */
export const compareTables = (a: string, b: string) => {
  const na = Number(a.match(/\d+/)?.[0] ?? NaN);
  const nb = Number(b.match(/\d+/)?.[0] ?? NaN);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
};
