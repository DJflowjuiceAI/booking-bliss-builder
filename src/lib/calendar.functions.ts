import { createServerFn } from "@tanstack/react-start";

export type CalendarReservation = {
  id: string;
  dateISO: string;
  shift: "Breakfast" | "Lunch" | "Dinner";
  timeLabel: string;
  guests: number;
  floor: "main" | "balcony" | "lounge" | "terrace";
  table: number;
  tables: number[];
  status: "confirmed" | "no-show" | "cancelled";
  source: "phone" | "email" | "online" | "walk-in";
  guestName: string;
  phone: string;
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
  createdBy?: { source?: string | null } | null;
};

const FLOOR_MAP: Record<string, CalendarReservation["floor"]> = {
  "main floor": "main",
  main: "main",
  balcony: "balcony",
  lounge: "lounge",
  terrace: "terrace",
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

// Preserve wall-clock time from the ISO offset instead of converting to server tz.
function splitIso(iso: string) {
  // e.g. "2026-07-09T14:00:00+04:00"
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
  if (v.includes("phone")) return "phone";
  if (v.includes("email")) return "email";
  if (v.includes("walk")) return "walk-in";
  return "online";
}

function toReservation(ev: RawEvent): CalendarReservation {
  const details = parseDetails(ev.description || ev.notes);
  const { dateISO, timeLabel, hour } = splitIso(ev.startTime);

  const floorRaw = (details["floor"] || "main floor").toLowerCase();
  const floor = FLOOR_MAP[floorRaw] || "main";

  const tablesStr = details["assigned table"] || details["table"] || "";
  const tables = tablesStr
    .split(/[,;/]/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const guests = Number(details["number of guests"] || details["guests"] || 2) || 2;

  return {
    id: ev.id,
    dateISO,
    shift: shiftForHour(hour),
    timeLabel,
    guests,
    floor,
    table: tables[0] ?? 0,
    tables,
    status: mapStatus(ev.appointmentStatus),
    source: mapSource(ev.createdBy?.source),
    guestName: ev.title || "Guest",
    phone: "",
    note: details["notes"] || undefined,
    bookingNumber: details["booking number"],
    tags: details["tags"],
  };
}

export const getCalendarEvents = createServerFn({ method: "GET" })
  .inputValidator((data: { startTime: number; endTime: number }) => {
    if (!Number.isFinite(data?.startTime) || !Number.isFinite(data?.endTime)) {
      throw new Error("startTime and endTime (ms) are required");
    }
    return data;
  })
  .handler(async ({ data }): Promise<CalendarReservation[]> => {
    const token = process.env.LEADCONNECTOR_API_TOKEN;
    const locationId = process.env.LEADCONNECTOR_LOCATION_ID;
    const calendarId = process.env.LEADCONNECTOR_CALENDAR_ID;

    if (!token || !locationId || !calendarId) {
      throw new Error("LeadConnector env vars are not configured");
    }

    const url = new URL("https://services.leadconnectorhq.com/calendars/events");
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("calendarId", calendarId);
    url.searchParams.set("startTime", String(data.startTime));
    url.searchParams.set("endTime", String(data.endTime));

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Version: "2021-04-15",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`LeadConnector request failed [${res.status}]: ${body}`);
      throw new Error(`Calendar request failed [${res.status}]`);
    }

    const json = (await res.json()) as { events?: RawEvent[] };
    const events = json.events || [];
    return events
      .filter((e) => e && e.startTime && (e as unknown as { deleted?: boolean }).deleted !== true)
      .map(toReservation);
  });
