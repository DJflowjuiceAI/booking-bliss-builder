import { createServerFn } from "@tanstack/react-start";

export type CalendarReservation = {
  id: string;
  dateISO: string;
  shift: "Breakfast" | "Lunch" | "Dinner";
  timeLabel: string;
  guests: number;
  floor: "main" | "balcony" | "lounge" | "terrace" | "vip" | "bar" | "outdoor" | "dinein";
  // FIX: tables stored as string names e.g. "TABLE.17", "BT.3", not bare numbers
  table: string;
  tables: string[];
  status: "confirmed" | "no-show" | "cancelled";
  source: "phone" | "email" | "online" | "walk-in";
  guestName: string;
  phone: string;
  contactId?: string;
  note?: string;
  bookingNumber?: string;
  tags?: string;
};

type RawEvent = {
  id: string;
  title?: string;
  appointmentStatus?: string;
  startTime: string;
  endTime?: string;
  notes?: string;
  description?: string;
  contactId?: string;           // FIX: present in API response, used for phone lookup
  createdBy?: { source?: string | null } | null;
};

// FIX: Expanded to cover all Thalassa floor names from GHL data
const FLOOR_MAP: Record<string, CalendarReservation["floor"]> = {
  "main floor": "main",
  "main":       "main",
  "balcony":    "balcony",
  "lounge":     "lounge",
  "terrace":    "terrace",
  "vip":        "vip",
  "vip lounge": "vip",
  "bar":        "bar",
  "bar counter":"bar",
  "outdoor":    "outdoor",
  "dine-in":    "dinein",
  "dine in":    "dinein",
  "dinein":     "dinein",
};

function parseDetails(text: string | undefined) {
  const out: Record<string, string> = {};
  if (!text) return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const idx = rawLine.indexOf(":");
    if (idx === -1) continue;
    const key = rawLine.slice(0, idx).trim().toLowerCase();
    const val = rawLine.slice(idx + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

// FIX: preserve wall-clock time from the ISO offset string
function splitIso(iso: string) {
  const [datePart, rest = ""] = iso.split("T");
  const time = rest.slice(0, 5); // HH:MM
  return { dateISO: datePart, timeLabel: time, hour: Number(time.slice(0, 2)) || 0 };
}

function shiftForHour(h: number): CalendarReservation["shift"] {
  return h < 12 ? "Breakfast" : h < 17 ? "Lunch" : "Dinner";
}

function mapStatus(s?: string): CalendarReservation["status"] {
  const v = (s || "").toLowerCase();
  if (v === "cancelled" || v === "canceled") return "cancelled";
  if (v === "noshow" || v === "no-show" || v === "no_show") return "no-show";
  return "confirmed";
}

function mapSource(s?: string | null): CalendarReservation["source"] {
  const v = (s || "").toLowerCase();
  if (v.includes("phone"))   return "phone";
  if (v.includes("email"))   return "email";
  if (v.includes("walk"))    return "walk-in";
  return "online";
}

// FIX: Parse table values as strings, not numbers.
// Handles: "TABLE.17", "TABLE.17, TABLE.18", "BT.3", "OUT.201", and legacy bare numbers like "5"
function parseTables(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // If it's already a named table like TABLE.17 or BT.3 → keep as-is
      if (/^[A-Z]+\.\d+$/i.test(s)) return s.toUpperCase();
      // If it's a bare number (legacy) → prefix with TABLE.
      if (/^\d+$/.test(s)) return `TABLE.${s}`;
      return s;
    });
}

function toReservation(ev: RawEvent): CalendarReservation {
  const details = parseDetails(ev.description || ev.notes);
  const { dateISO, timeLabel, hour } = splitIso(ev.startTime);

  const floorRaw = (details["floor"] || "main floor").toLowerCase();
  const floor    = FLOOR_MAP[floorRaw] || "main";

  // FIX: parse as string table names
  const tablesStr = details["assigned table"] || details["table"] || "";
  const tables    = parseTables(tablesStr);
  const guests    = Number(details["number of guests"] || details["guests"] || 2) || 2;

  return {
    id:           ev.id,
    dateISO,
    shift:        shiftForHour(hour),
    timeLabel,
    guests,
    floor,
    table:        tables[0] ?? "",     // FIX: string, not number
    tables,
    status:       mapStatus(ev.appointmentStatus),
    source:       mapSource(ev.createdBy?.source),
    guestName:    ev.title || "Guest",
    phone:        "",                  // populated below via contact lookup
    contactId:    ev.contactId,
    note:         details["notes"] || undefined,
    bookingNumber:details["booking number"],
    tags:         details["tags"],
  };
}

/* ── FETCH EVENTS ────────────────────────────────────── */

export const getCalendarEvents = createServerFn({ method: "GET" })
  .inputValidator((data: { startTime: number; endTime: number }) => {
    if (!Number.isFinite(data?.startTime) || !Number.isFinite(data?.endTime))
      throw new Error("startTime and endTime (ms) are required");
    return data;
  })
  .handler(async ({ data }): Promise<CalendarReservation[]> => {
    const token      = process.env.LEADCONNECTOR_API_TOKEN;
    const locationId = process.env.LEADCONNECTOR_LOCATION_ID;
    const calendarId = process.env.LEADCONNECTOR_CALENDAR_ID;

    if (!token || !locationId || !calendarId)
      throw new Error(
        "Missing env vars: LEADCONNECTOR_API_TOKEN, LEADCONNECTOR_LOCATION_ID, LEADCONNECTOR_CALENDAR_ID"
      );

    const url = new URL("https://services.leadconnectorhq.com/calendars/events");
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("calendarId", calendarId);
    url.searchParams.set("startTime",  String(data.startTime));
    url.searchParams.set("endTime",    String(data.endTime));

    const res = await fetch(url.toString(), {
      headers: {
        Accept:        "application/json",
        Version:       "v3",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`LeadConnector request failed [${res.status}]: ${body}`);
      throw new Error(`Calendar request failed [${res.status}]`);
    }

    const json   = (await res.json()) as { events?: RawEvent[] };
    const events = (json.events || []).filter(
      (e) =>
        e && e.startTime && (e as unknown as { deleted?: boolean }).deleted !== true
    );

    const reservations = events.map(toReservation);

    // FIX: Enrich with phone numbers from contact records.
    // Batch: collect unique contactIds and fetch them in parallel (max 10 concurrent).
    const contactIds = [
      ...new Set(reservations.map((r) => r.contactId).filter(Boolean) as string[]),
    ];

    if (contactIds.length > 0) {
      const phoneMap = new Map<string, string>();

      // Fetch contacts in batches of 10
      const BATCH = 10;
      for (let i = 0; i < contactIds.length; i += BATCH) {
        const batch = contactIds.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (cid) => {
            try {
              const cr = await fetch(
                `https://services.leadconnectorhq.com/contacts/${cid}`,
                {
                  headers: {
                    Accept:        "application/json",
                    Version:       "v3",
                    Authorization: `Bearer ${token}`,
                  },
                }
              );
              if (!cr.ok) return;
              const cj = (await cr.json()) as {
                contact?: { phone?: string };
                phone?: string;
              };
              const phone = cj.contact?.phone ?? cj.phone ?? "";
              if (phone) phoneMap.set(cid, phone);
            } catch {
              /* skip individual contact failures */
            }
          })
        );
      }

      // Apply phones back to reservations
      reservations.forEach((r) => {
        if (r.contactId && phoneMap.has(r.contactId)) {
          r.phone = phoneMap.get(r.contactId)!;
        }
      });
    }

    return reservations;
  });
