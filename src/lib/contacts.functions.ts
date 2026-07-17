import { createServerFn } from "@tanstack/react-start";

export type ContactSearchResult = {
  id: string;
  name: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  tags: string[];
};

type RawContact = {
  id: string;
  contactName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  tags?: string[] | null;
};

export const searchContacts = createServerFn({ method: "POST" })
  .inputValidator((data: { query: string }) => {
    if (typeof data?.query !== "string") throw new Error("query is required");
    return data;
  })
  .handler(async ({ data }): Promise<ContactSearchResult[]> => {
    const q = data.query.trim();
    if (q.length < 2) return [];

    const token = process.env.LEADCONNECTOR_API_TOKEN;
    const locationId = process.env.LEADCONNECTOR_LOCATION_ID;
    if (!token || !locationId) throw new Error("LeadConnector env vars are not configured");

    const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Version: "v3",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ locationId, page: 1, pageLimit: 20, query: q }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Contact search failed [${res.status}]: ${body}`);
      throw new Error(`Contact search failed [${res.status}]`);
    }

    const json = (await res.json()) as { contacts?: RawContact[] };
    return (json.contacts || []).map((c) => {
      const first = c.firstName || "";
      const last = c.lastName || "";
      const composed = `${first} ${last}`.trim();
      const name = composed || c.contactName || c.email || "Unnamed";
      return {
        id: c.id,
        name,
        email: c.email || "",
        phone: c.phone || "",
        firstName: first,
        lastName: last,
        tags: c.tags || [],
      };
    });
  });
