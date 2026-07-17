import { createServerFn } from "@tanstack/react-start";

export type CreateReservationInput = {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  contactId?: string | null;
  dateISO: string;       // YYYY-MM-DD
  timeLabel: string;     // HH:MM (24h)
  durationMinutes?: number;
  guests: number;
  floor: string;
  tables: string[];      // FIX: string table names e.g. "TABLE.17", "BT.3"
  status: "confirmed" | "seated" | "completed" | "no-show" | "cancelled";
  bookingNumber?: string;
  tags?: string;
  note?: string;
};

export type CreateReservationResult = {
  appointmentId: string;
  contactId: string;
  bookingNumber: string;
};

export type UpdateStatusInput = {
  appointmentId: string;
  status: "confirmed" | "seated" | "completed" | "no-show" | "cancelled";
};

export type UpdateReservationInput = CreateReservationInput & {
  appointmentId: string;
  title: string;
};

const BOOKING_NUMBER_FIELD_ID = "gMjbx4dwxAGQGPGxI17l";
const SEATED_WORKFLOW_ID = "aa36db51-b4dd-4166-8705-ec005bec5ddc";

// FIX: Greece is UTC+3 (EEST summer) / UTC+2 (EET winter).
// Using +03:00 for summer (Apr–Oct covers the restaurant season).
const TZ_OFFSET = "+03:00";

const FLOOR_LABEL: Record<string, string> = {
  main:    "Main Floor",
  balcony: "Balcony",
  lounge:  "Lounge",
  terrace: "Terrace",
  vip:     "VIP",
  bar:     "Bar",
  outdoor: "Outdoor",
  dinein:  "Dine-in",
};

// Runtime fallback when the UI does not send the next visible booking number.
let _localCounter = 3000;
function nextBookingNumber(): string {
  _localCounter++;
  return String(_localCounter);
}

function normalizeTags(tags?: string) {
  return (tags || "")
    .split(/[,;/\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function env() {
  const token          = process.env.LEADCONNECTOR_API_TOKEN;
  const locationId     = process.env.LEADCONNECTOR_LOCATION_ID;
  const calendarId     = process.env.LEADCONNECTOR_CALENDAR_ID;
  const assignedUserId =
    process.env.LEADCONNECTOR_ASSIGNED_USER_ID ||
    process.env.LEADCONNECTOR_USER_ID;
  if (!token || !locationId || !calendarId) {
    throw new Error(
      "Missing env vars: LEADCONNECTOR_API_TOKEN, LEADCONNECTOR_LOCATION_ID, LEADCONNECTOR_CALENDAR_ID"
    );
  }
  return { token, locationId, calendarId, assignedUserId };
}

function addMinutes(dateISO: string, timeLabel: string, minutes: number) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = timeLabel.split(":").map(Number);

  const base = new Date(y, m - 1, d, hh, mm);
  base.setMinutes(base.getMinutes() + minutes);

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(
    base.getDate()
  )}T${pad(base.getHours())}:${pad(base.getMinutes())}:00${TZ_OFFSET}`;
}

function buildStartIso(dateISO: string, timeLabel: string) {
  return `${dateISO}T${timeLabel}:00${TZ_OFFSET}`;
}

function appointmentStatusForApi(status: CreateReservationInput["status"]) {
  switch (status) {
    case "confirmed":
      return "confirmed";

    case "seated":
      return "confirmed";      // <-- Change this

    case "completed":
      return "showed";

    case "no-show":
      return "noshow";

    case "cancelled":
      return "cancelled";

    default:
      return "confirmed";
  }
}

function buildDescription(data: CreateReservationInput) {
  const floorLabel = FLOOR_LABEL[data.floor] || data.floor;
  const lines = [
    `Booking Number : ${data.bookingNumber || nextBookingNumber()}`,
    `Number of Guests : ${data.guests}`,
    `Floor : ${floorLabel}`,
    `Assigned Table : ${data.tables.join(", ")}`,
    `Reservation Status : ${data.status}`,
  ];
  if (data.tags) lines.push(`Tags : ${data.tags}`);
  if (data.note) lines.push(`Notes : ${data.note}`);
  console.log("buildDescription status:", data.status);
  return lines.join("\n");
}

function buildAppointmentPayload(
  data: CreateReservationInput & { title: string; contactId?: string | null },
  calendarId: string,
  locationId: string | undefined,
  assignedUserId: string | undefined,
) {
  const startTime = buildStartIso(data.dateISO, data.timeLabel);
  const endTime = addMinutes(data.dateISO, data.timeLabel, data.durationMinutes ?? 90);
  const payload: Record<string, unknown> = {
    title: data.title,
    meetingLocationType: "custom",
    meetingLocationId: "custom_0",
    overrideLocationConfig: true,
    appointmentStatus: appointmentStatusForApi(data.status),
    calendarId,
    description: buildDescription(data),
    address: "Restaurant",
    startTime,
    endTime,
    ignoreDateRange: false,
    ignoreFreeSlotValidation: true,
    toNotify: false,
  };
  if (locationId) payload.locationId = locationId;
  if (data.contactId) payload.contactId = data.contactId;
  if (assignedUserId) payload.assignedUserId = assignedUserId;
  return payload;
}

async function searchContactByEmailOrPhone(
  token: string,
  locationId: string,
  query: string
): Promise<{ id: string; firstName?: string; lastName?: string } | null> {
  const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept:         "application/json",
      Version:        "v3",                // FIX: was "2021-07-28"
      Authorization:  `Bearer ${token}`,
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
  input: CreateReservationInput
): Promise<string> {
  const body: Record<string, unknown> = {
    firstName: input.firstName,
    lastName:  input.lastName,
    name:      `${input.firstName} ${input.lastName}`.trim(),
    locationId,
    source:    "reservation dashboard",
  };
  if (input.email) body.email = input.email;
  if (input.phone) body.phone = input.phone;

  const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept:         "application/json",
      Version:        "v3",                // FIX: was "2021-07-28"
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text) as { meta?: { contactId?: string } };
      if (j.meta?.contactId) return j.meta.contactId; // duplicate → reuse
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

async function addContactTags(
  token: string,
  contactId: string,
  tags?: string,
) {
  const tagList = normalizeTags(tags);
  if (!contactId || tagList.length === 0) return;
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept:         "application/json",
      Version:        "v3",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({ tags: tagList }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Add contact tags failed [${res.status}]: ${body}`);
  }
}

async function updateContactBookingNumber(
  token: string,
  contactId: string,
  bookingNumber: string,
) {
  if (!contactId || !bookingNumber) return;
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept:         "application/json",
      Version:        "v3",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({
      customFields: [
        {
          id: BOOKING_NUMBER_FIELD_ID,
          value: bookingNumber,
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Update booking number custom field failed [${res.status}]: ${body}`);
  }
}

async function addContactToWorkflow(
  token: string,
  contactId: string,
  eventStartTime: string,
) {
  if (!contactId) return;

  const res = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contactId}/workflow/${SEATED_WORKFLOW_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Version: "2021-04-15",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eventStartTime,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`Add contact to workflow failed [${res.status}]: ${body}`);
  }
}

/* ── CREATE ───────────────────────────────────────────── */

export const createReservation = createServerFn({ method: "POST" })
  .inputValidator((data: CreateReservationInput) => {
    if (!data?.firstName?.trim() || !data?.lastName?.trim())
      throw new Error("firstName and lastName are required");
    if (!data.email && !data.phone)
      throw new Error("Email or phone is required");
    if (!data.dateISO || !data.timeLabel)
      throw new Error("date and time are required");
    if (!data.tables?.length)
      throw new Error("At least one table is required");
    return data;
  })
  .handler(async ({ data }): Promise<CreateReservationResult> => {
    const { token, locationId, calendarId, assignedUserId } = env();

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

    // 2. Build description — stores all metadata for reading back later
    await addContactTags(token, contactId, data.tags);

    const bookingNumber = data.bookingNumber?.trim() || nextBookingNumber();
    await updateContactBookingNumber(token, contactId, bookingNumber);
    const payload = buildAppointmentPayload(
      {
        ...data,
        bookingNumber,
        title: `${data.firstName} ${data.lastName}`.trim(),
        contactId,
      },
      calendarId,
      locationId,
      assignedUserId,
    );

    const res = await fetch(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept:         "application/json",
          Version:        "v3",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await res.text();
    if (!res.ok) {
      console.error(`Create appointment failed [${res.status}]: ${text}`);
      throw new Error(`Create appointment failed [${res.status}]: ${text}`);
    }
    const json = JSON.parse(text) as { id?: string; appointment?: { id?: string } };
    const appointmentId = json.id ?? json.appointment?.id ?? "";
    return { appointmentId, contactId, bookingNumber };
  });

/* ── UPDATE STATUS ───────────────────────────────────── */

export const updateReservation = createServerFn({ method: "POST" })
  .inputValidator((data: UpdateReservationInput) => {
    if (!data?.appointmentId?.trim()) throw new Error("appointmentId is required");
    if (!data.title?.trim()) throw new Error("title is required");
    if (!data.dateISO || !data.timeLabel) throw new Error("date and time are required");
    if (!data.tables?.length) throw new Error("At least one table is required");
    return data;
  })
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { token, calendarId, assignedUserId } = env();

    if (data.contactId) {
      if (data.status === "seated") {
        await addContactToWorkflow(
          token,
          data.contactId,
          buildStartIso(data.dateISO, data.timeLabel),
        );
      }

      await addContactTags(token, data.contactId, data.tags);

      if (data.bookingNumber) {
        await updateContactBookingNumber(
          token,
          data.contactId,
          data.bookingNumber,
        );
      }
    }

    const payload = buildAppointmentPayload(
      data,
      calendarId,
      undefined,
      assignedUserId,
    );

    const res = await fetch(
      `https://services.leadconnectorhq.com/calendars/events/appointments/${data.appointmentId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept:         "application/json",
          Version:        "v3",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await res.text();
    if (!res.ok) {
      console.error(`Update appointment failed [${res.status}]: ${text}`);
      throw new Error(`Update appointment failed [${res.status}]: ${text}`);
    }
    return { ok: true };
  });

export const updateReservationStatus = createServerFn({ method: "POST" })
  .inputValidator((data: UpdateStatusInput) => {
    if (!data?.appointmentId?.trim()) throw new Error("appointmentId is required");
    if (!["confirmed", "seated", "completed", "no-show", "cancelled"].includes(data.status))
      throw new Error("Invalid status value");
    return data;
  })
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { token } = env();

    // GHL uses "noshow" not "no-show"
    const appointmentStatus =
      data.status === "no-show"
        ? "noshow"
        : data.status === "completed"
          ? "showed"
          : data.status === "seated"
            ? "confirmed"
            : data.status;

    const res = await fetch(
      `https://services.leadconnectorhq.com/calendars/events/appointments/${data.appointmentId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept:         "application/json",
          Version:        "v3",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ appointmentStatus }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`Update appointment failed [${res.status}]: ${body}`);
      throw new Error(`Update appointment failed [${res.status}]`);
    }
    return { ok: true };
  });
