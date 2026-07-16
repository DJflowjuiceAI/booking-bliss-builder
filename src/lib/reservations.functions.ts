import { createServerFn } from "@tanstack/react-start";

export type CreateReservationInput = {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  contactId?: string | null;
  dateISO: string; // YYYY-MM-DD
  timeLabel: string; // HH:MM (24h)
  durationMinutes?: number;
  guests: number;
  floor: string; // e.g. "main" | "balcony" | "lounge" | "terrace"
  tables: number[];
  status: "confirmed" | "no-show" | "cancelled";
  tags?: string;
  note?: string;
};

export type CreateReservationResult = {
  appointmentId: string;
  contactId: string;
  bookingNumber: string;
};

const TZ_OFFSET = "+04:00"; // Dubai — matches existing calendar data

const FLOOR_LABEL: Record<string, string> = {
  main: "Main Floor",
  balcony: "Balcony",
  lounge: "Lounge",
  terrace: "Terrace",
};

function env() {
  const token = process.env.LEADCONNECTOR_API_TOKEN;
  const locationId = process.env.LEADCONNECTOR_LOCATION_ID;
  const calendarId = process.env.LEADCONNECTOR_CALENDAR_ID;
  if (!token || !locationId || !calendarId) {
    throw new Error("LeadConnector env vars are not configured");
  }
  return { token, locationId, calendarId };
}

function addMinutes(dateISO: string, timeLabel: string, minutes: number) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = timeLabel.split(":").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, hh, mm));
  base.setUTCMinutes(base.getUTCMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(
    base.getUTCDate(),
  )}T${pad(base.getUTCHours())}:${pad(base.getUTCMinutes())}:00${TZ_OFFSET}`;
}

function buildStartIso(dateISO: string, timeLabel: string) {
  return `${dateISO}T${timeLabel}:00${TZ_OFFSET}`;
}

async function searchContactByEmailOrPhone(
  token: string,
  locationId: string,
  query: string,
): Promise<{ id: string; firstName?: string; lastName?: string } | null> {
  const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Version: "v3",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ locationId, page: 1, pageLimit: 5, query }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    contacts?: Array<{ id: string; firstName?: string; lastName?: string }>;
  };
  return json.contacts?.[0] ?? null;
}

async function createContact(
  token: string,
  locationId: string,
  input: CreateReservationInput,
): Promise<string> {
  const body: Record<string, unknown> = {
    firstName: input.firstName,
    lastName: input.lastName,
    name: `${input.firstName} ${input.lastName}`.trim(),
    locationId,
    source: "reservation dashboard",
  };
  if (input.email) body.email = input.email;
  if (input.phone) body.phone = input.phone;

  const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Version: "2021-07-28",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    // Duplicate → API returns the existing contact id in meta.contactId
    try {
      const j = JSON.parse(text) as { meta?: { contactId?: string } };
      if (j.meta?.contactId) return j.meta.contactId;
    } catch {
      /* noop */
    }
    console.error(`Create contact failed [${res.status}]: ${text}`);
    throw new Error(`Create contact failed [${res.status}]`);
  }
  const json = JSON.parse(text) as { contact?: { id?: string }; id?: string };
  const id = json.contact?.id ?? json.id;
  if (!id) throw new Error("Create contact returned no id");
  return id;
}

export const createReservation = createServerFn({ method: "POST" })
  .inputValidator((data: CreateReservationInput) => {
    if (!data?.firstName?.trim() || !data?.lastName?.trim()) {
      throw new Error("firstName and lastName are required");
    }
    if (!data.email && !data.phone) {
      throw new Error("Email or phone is required");
    }
    if (!data.dateISO || !data.timeLabel) throw new Error("date and time are required");
    if (!data.tables?.length) throw new Error("At least one table is required");
    return data;
  })
  .handler(async ({ data }): Promise<CreateReservationResult> => {
    const { token, locationId, calendarId } = env();

    // 1. Resolve contactId
    let contactId = data.contactId?.trim() || "";
    if (!contactId) {
      const query = data.email || data.phone || "";
      if (query) {
        const found = await searchContactByEmailOrPhone(token, locationId, query);
        if (found) contactId = found.id;
      }
    }
    if (!contactId) {
      contactId = await createContact(token, locationId, data);
    }

    // 2. Build description with our custom fields (matches calendar parser)
    const bookingNumber = String(Date.now()).slice(-6);
    const floorLabel = FLOOR_LABEL[data.floor] || data.floor;
    const descLines = [
      `Booking Number : ${bookingNumber}`,
      `Number of Guests : ${data.guests}`,
      `Floor : ${floorLabel}`,
      `Assigned Table : ${data.tables.join(",")}`,
    ];
    if (data.tags) descLines.push(`Tags : ${data.tags}`);
    if (data.note) descLines.push(`Notes : ${data.note}`);

    const startTime = buildStartIso(data.dateISO, data.timeLabel);
    const endTime = addMinutes(data.dateISO, data.timeLabel, data.durationMinutes ?? 90);

    const appointmentStatus =
      data.status === "no-show" ? "noshow" : data.status; // API uses "noshow"

    const payload = {
      title: `${data.firstName} ${data.lastName}`.trim(),
      appointmentStatus,
      calendarId,
      locationId,
      contactId,
      description: descLines.join("\n"),
      startTime,
      endTime,
      ignoreDateRange: true,
      ignoreFreeSlotValidation: true,
      toNotify: false,
    };

    const res = await fetch(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Version: "v3",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      console.error(`Create appointment failed [${res.status}]: ${text}`);
      throw new Error(`Create appointment failed [${res.status}]`);
    }
    const json = JSON.parse(text) as { id?: string; appointment?: { id?: string } };
    const appointmentId = json.id ?? json.appointment?.id ?? "";
    return { appointmentId, contactId, bookingNumber };
  });
