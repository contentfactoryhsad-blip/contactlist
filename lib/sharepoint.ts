import { z } from "zod";
import { getGraphToken } from "@/lib/msgraph";

const siteUrl = process.env.SHAREPOINT_SITE_URL ?? "";
const siteIdOverride = process.env.SHAREPOINT_SITE_ID ?? "";

const LISTS = {
  requests: process.env.SP_LIST_REQUESTS ?? "Requests",
  activeAccess: process.env.SP_LIST_ACTIVE_ACCESS ?? "ActiveAccess",
  reference: process.env.SP_LIST_REFERENCE ?? "ReferenceHierarchy",
  admins: process.env.SP_LIST_ADMINS ?? "AdminUsers",
  settings: process.env.SP_LIST_SETTINGS ?? "AdminSettings"
};

export type GraphListItem<T> = {
  id: string;
  fields: T & Record<string, unknown>;
};

function escapeOdataValue(value: string) {
  return value.replace(/'/g, "''");
}

function encodeOdataQuery(value: string) {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

let cachedSiteId: string | null = null;

async function resolveSiteId() {
  if (siteIdOverride) return siteIdOverride;
  if (cachedSiteId) return cachedSiteId;
  if (!siteUrl) {
    throw new Error("SHAREPOINT_SITE_URL is not configured.");
  }

  const url = new URL(siteUrl);
  const host = url.hostname;
  const path = url.pathname.replace(/\/$/, "");
  const res = await graphFetch(`/sites/${host}:${path}`);
  cachedSiteId = res.id;
  return cachedSiteId;
}

async function graphFetch(path: string, options?: RequestInit) {
  const token = await getGraphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph error ${res.status}: ${err}`);
  }

  return res.json();
}

async function graphFetchAbsolute(url: string, options?: RequestInit) {
  const token = await getGraphToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph error ${res.status}: ${err}`);
  }

  return res.json();
}

async function listItems<T>(listName: string, query?: string) {
  const siteId = await resolveSiteId();
  let url = `/sites/${siteId}/lists/${listName}/items?$expand=fields&$top=200`;
  if (query) {
    url += `&${query}`;
  }
  const items: GraphListItem<T>[] = [];
  let data = await graphFetch(url);
  items.push(...data.value);
  while (data["@odata.nextLink"]) {
    data = await graphFetchAbsolute(data["@odata.nextLink"]);
    items.push(...data.value);
  }
  return items;
}

async function createItem<T>(listName: string, fields: T) {
  const siteId = await resolveSiteId();
  const data = await graphFetch(`/sites/${siteId}/lists/${listName}/items`, {
    method: "POST",
    body: JSON.stringify({ fields })
  });
  return data as GraphListItem<T>;
}

async function updateItem<T>(listName: string, id: string, fields: T) {
  const siteId = await resolveSiteId();
  const data = await graphFetch(`/sites/${siteId}/lists/${listName}/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
  return data as GraphListItem<T>;
}

async function createItems<T>(listName: string, records: T[]) {
  const created: GraphListItem<T>[] = [];
  for (const fields of records) {
    const item = await createItem(listName, fields);
    created.push(item);
  }
  return created;
}

export async function isAdminEmail(email: string) {
  const filter = `fields/Email eq '${escapeOdataValue(email.toLowerCase())}'`;
  const items = await listItems<{ Email: string }>(
    LISTS.admins,
    `$filter=${encodeOdataQuery(filter)}`
  );
  return items.length > 0;
}

export async function getAdminSettings() {
  const items = await listItems<{ CentralAdminEmail?: string; AdminNotifyRecipients?: string }>(
    LISTS.settings
  );
  const item = items[0];
  return {
    id: item?.id ?? null,
    centralAdminEmail: item?.fields.CentralAdminEmail ?? "",
    adminNotifyRecipients: item?.fields.AdminNotifyRecipients ?? ""
  };
}

export async function upsertAdminSettings(settings: {
  centralAdminEmail: string;
  adminNotifyRecipients: string;
}) {
  const existing = await getAdminSettings();
  const fields = {
    Title: "Settings",
    CentralAdminEmail: settings.centralAdminEmail,
    AdminNotifyRecipients: settings.adminNotifyRecipients
  };
  if (existing.id) {
    await updateItem(LISTS.settings, existing.id, fields);
    return { id: existing.id, ...fields };
  }
  const created = await createItem(LISTS.settings, fields);
  return { id: created.id, ...created.fields };
}

export async function getHierarchyRows() {
  const items = await listItems<{ Region?: string; Subsidiary?: string; Branch?: string; IsActive?: boolean }>(
    LISTS.reference
  );
  return items
    .filter((item) => item.fields.IsActive !== false)
    .map((item) => ({
      Region: item.fields.Region ?? "",
      Subsidiary: item.fields.Subsidiary ?? "",
      Branch: item.fields.Branch ?? ""
    }))
    .filter((row) => row.Region && row.Subsidiary && row.Branch);
}

export async function listRequestsByEmail(email: string) {
  const filter = `fields/RequesterEmail eq '${escapeOdataValue(email.toLowerCase())}'`;
  const order = encodeOdataQuery("fields/Created desc");
  return listItems<Record<string, unknown>>(
    LISTS.requests,
    `$filter=${encodeOdataQuery(filter)}&$orderby=${order}`
  );
}

export async function listAllRequests() {
  const order = encodeOdataQuery("fields/Created desc");
  return listItems<Record<string, unknown>>(
    LISTS.requests,
    `$orderby=${order}`
  );
}

export async function listActiveAccess() {
  const order = encodeOdataQuery("fields/ActivatedAt desc");
  return listItems<Record<string, unknown>>(
    LISTS.activeAccess,
    `$orderby=${order}`
  );
}

export async function countActiveAccess(branch: string, access: string) {
  const filter = `fields/Branch eq '${escapeOdataValue(branch)}' and fields/AirtableAccess eq '${escapeOdataValue(access)}'`;
  const items = await listItems<Record<string, unknown>>(
    LISTS.activeAccess,
    `$filter=${encodeOdataQuery(filter)}`
  );
  return items.length;
}

export async function countPendingRequests(branch: string, access: string) {
  const filter = `fields/Branch eq '${escapeOdataValue(branch)}' and fields/AirtableAccess eq '${escapeOdataValue(access)}' and (fields/Status eq 'Request Submitted' or fields/Status eq 'Pending')`;
  const items = await listItems<Record<string, unknown>>(
    LISTS.requests,
    `$filter=${encodeOdataQuery(filter)}`
  );
  return items.length;
}

export async function hasDuplicateRequest(email: string, branch: string, access: string) {
  const activeFilter = `fields/Email eq '${escapeOdataValue(email)}' and fields/Branch eq '${escapeOdataValue(branch)}' and fields/AirtableAccess eq '${escapeOdataValue(access)}'`;
  const activeItems = await listItems<Record<string, unknown>>(
    LISTS.activeAccess,
    `$filter=${encodeOdataQuery(activeFilter)}`
  );
  if (activeItems.length > 0) {
    return true;
  }

  const requestFilter = `fields/RequesterEmail eq '${escapeOdataValue(email)}' and fields/Branch eq '${escapeOdataValue(branch)}' and fields/AirtableAccess eq '${escapeOdataValue(access)}' and (fields/Status eq 'Request Submitted' or fields/Status eq 'Pending')`;
  const requestItems = await listItems<Record<string, unknown>>(
    LISTS.requests,
    `$filter=${encodeOdataQuery(requestFilter)}`
  );
  return requestItems.length > 0;
}

export async function hasActiveAccess(email: string, branch: string, access: string) {
  const activeFilter = `fields/Email eq '${escapeOdataValue(email)}' and fields/Branch eq '${escapeOdataValue(branch)}' and fields/AirtableAccess eq '${escapeOdataValue(access)}'`;
  const items = await listItems<Record<string, unknown>>(
    LISTS.activeAccess,
    `$filter=${encodeOdataQuery(activeFilter)}`
  );
  return items.length > 0;
}

export async function createRequestRecord(fields: {
  Region: string;
  Subsidiary: string;
  Branch: string;
  Name: string;
  Position: string;
  RR: string;
  RequesterEmail: string;
  AirtableAccess: string;
  Status: string;
  AdminComment?: string;
}) {
  return createItem(LISTS.requests, {
    Title: `${fields.RequesterEmail}-${fields.Branch}-${fields.AirtableAccess}`,
    ...fields
  });
}

export async function updateRequestRecord(id: string, fields: Record<string, unknown>) {
  return updateItem(LISTS.requests, id, fields);
}

export async function addActiveAccess(fields: {
  Region: string;
  Subsidiary: string;
  Branch: string;
  Name: string;
  Position: string;
  RR: string;
  Email: string;
  AirtableAccess: string;
  SourceRequestId: string;
  ActivatedAt: string;
}) {
  return createItem(LISTS.activeAccess, {
    Title: `${fields.Email}-${fields.Branch}-${fields.AirtableAccess}`,
    ...fields
  });
}

export async function createReferenceRows(records: {
  Region: string;
  Subsidiary: string;
  Branch: string;
  IsActive: boolean;
}[]) {
  const withTitle = records.map((record) => ({
    Title: `${record.Region}-${record.Subsidiary}-${record.Branch}`,
    ...record
  }));
  return createItems(LISTS.reference, withTitle);
}

export async function createActiveAccessRows(records: {
  Region: string;
  Subsidiary: string;
  Branch: string;
  Name: string;
  Email?: string;
  Position?: string;
  RR?: string;
  AirtableAccess: string;
}[]) {
  const withTitle = records.map((record) => ({
    Title: `${record.Email ?? record.Name}-${record.Branch}-${record.AirtableAccess}`,
    ...record
  }));
  return createItems(LISTS.activeAccess, withTitle);
}

export function mapRequestForExport(
  fields: Record<string, unknown>,
  createdDateTime?: string
) {
  return {
    Region: fields.Region ?? "",
    Subsidiary: fields.Subsidiary ?? "",
    Branch: fields.Branch ?? "",
    Name: fields.Name ?? "",
    Position: fields.Position ?? "",
    "R&R": fields.RR ?? "",
    "Requester Email": fields.RequesterEmail ?? "",
    "Airtable Access": fields.AirtableAccess ?? "",
    Status: fields.Status ?? "",
    "Admin Comment": fields.AdminComment ?? "",
    Created: fields.Created ?? createdDateTime ?? ""
  };
}

export function mapActiveForExport(fields: Record<string, unknown>) {
  return {
    Region: fields.Region ?? "",
    Subsidiary: fields.Subsidiary ?? "",
    Branch: fields.Branch ?? "",
    Name: fields.Name ?? "",
    Email: fields.Email ?? "",
    Position: fields.Position ?? "",
    "R&R": fields.RR ?? "",
    "Airtable Access": fields.AirtableAccess ?? "",
    "Source Request ID": fields.SourceRequestId ?? "",
    "Activated At": fields.ActivatedAt ?? ""
  };
}

export const requestSchema = z.object({
  region: z.string().min(1),
  subsidiary: z.string().min(1),
  branch: z.string().min(1),
  name: z.string().min(1),
  position: z.string().min(1),
  rr: z.string().min(1),
  access: z.enum(["Viewer", "Editor"])
});

export const SHAREPOINT_LISTS = LISTS;
