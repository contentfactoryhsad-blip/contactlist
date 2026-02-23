import crypto from "crypto";
import { z } from "zod";

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID ?? "";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY ?? "";

const TABLES = {
  requests: process.env.AIRTABLE_TABLE_REQUESTS ?? "Requests",
  activeAccess: process.env.AIRTABLE_TABLE_ACTIVE_ACCESS ?? "ActiveAccess",
  reference: process.env.AIRTABLE_TABLE_REFERENCE ?? "ReferenceHierarchy",
  admins: process.env.AIRTABLE_TABLE_ADMINS ?? "AdminUsers",
  settings: process.env.AIRTABLE_TABLE_SETTINGS ?? "AdminSettings",
  deletedRequests: process.env.AIRTABLE_TABLE_DELETED_REQUESTS ?? "DeletedRequests",
  deletedActiveAccess:
    process.env.AIRTABLE_TABLE_DELETED_ACTIVE_ACCESS ?? "DeletedActiveAccess",
  accessOtp: process.env.AIRTABLE_TABLE_ACCESS_OTP ?? "AccessOtp",
  loginAudit: process.env.AIRTABLE_TABLE_LOGIN_AUDIT ?? "LoginAudit"
};

const WRITE_FIELD_ALIASES: Record<string, string> = {
  RR: "R&R",
  RequestType: "Request Type",
  RequesterEmail: "Requester Email",
  AirtableAccess: "Airtable Access",
  CurrentAccess: "Current Access",
  RequestedAccess: "Requested Access",
  ChangeReason: "Change Reason",
  AdminComment: "Admin Comment",
  CreatedAt: "Created At",
  UpdatedAt: "Updated At",
  SourceRequestId: "Source Request ID",
  ActivatedAt: "Activated At",
  CentralAdminEmail: "Central Admin Email",
  AdminNotifyRecipients: "Admin Notify Recipients",
  IsActive: "Is Active",
  LastSentAt: "Last Sent At",
  UserAgent: "User Agent",
  AcceptLanguage: "Accept Language"
};

if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
  console.warn("Missing Airtable configuration. Check environment variables.");
}

const airtableBaseUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

export type AirtableRecord<T> = {
  id: string;
  fields: T;
  createdTime?: string;
  createdDateTime?: string;
};

function asString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function readField(fields: Record<string, unknown>, name: string) {
  const value = fields[name];
  if (value !== undefined && value !== null && value !== "") {
    return asString(value);
  }

  const alias = WRITE_FIELD_ALIASES[name];
  if (alias) {
    const aliasValue = fields[alias];
    if (aliasValue !== undefined && aliasValue !== null && aliasValue !== "") {
      return asString(aliasValue);
    }
  }

  return "";
}

function readBoolField(fields: Record<string, unknown>, name: string, defaultValue = false) {
  const value = fields[name] ?? fields[WRITE_FIELD_ALIASES[name]];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return defaultValue;
}

function normalizeRequestFields(fields: Record<string, unknown>) {
  return {
    RequestId: readField(fields, "RequestId"),
    RequestType: readField(fields, "RequestType") || "New Access",
    Region: readField(fields, "Region"),
    Subsidiary: readField(fields, "Subsidiary"),
    Branch: readField(fields, "Branch"),
    Name: readField(fields, "Name"),
    Position: readField(fields, "Position"),
    RR: readField(fields, "RR"),
    RequesterEmail: readField(fields, "RequesterEmail"),
    AirtableAccess: readField(fields, "AirtableAccess"),
    CurrentAccess: readField(fields, "CurrentAccess"),
    RequestedAccess: readField(fields, "RequestedAccess"),
    ChangeReason: readField(fields, "ChangeReason"),
    Status: readField(fields, "Status"),
    AdminComment: readField(fields, "AdminComment"),
    CreatedAt: readField(fields, "CreatedAt"),
    UpdatedAt: readField(fields, "UpdatedAt")
  };
}

function normalizeActiveAccessFields(fields: Record<string, unknown>) {
  return {
    Region: readField(fields, "Region"),
    Subsidiary: readField(fields, "Subsidiary"),
    Branch: readField(fields, "Branch"),
    Name: readField(fields, "Name"),
    Email: readField(fields, "Email"),
    Position: readField(fields, "Position"),
    RR: readField(fields, "RR"),
    AirtableAccess: readField(fields, "AirtableAccess"),
    SourceRequestId: readField(fields, "SourceRequestId"),
    ActivatedAt: readField(fields, "ActivatedAt")
  };
}

function normalizeOtpFields(fields: Record<string, unknown>) {
  return {
    RecordId: readField(fields, "RecordId"),
    Email: readField(fields, "Email"),
    CodeHash: readField(fields, "CodeHash"),
    ExpiresAt: readField(fields, "ExpiresAt"),
    CreatedAt: readField(fields, "CreatedAt"),
    Attempts: readField(fields, "Attempts") || "0",
    UsedAt: readField(fields, "UsedAt"),
    LastSentAt: readField(fields, "LastSentAt")
  };
}

async function airtableFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${airtableBaseUrl}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Airtable error ${res.status}: ${errorBody}`);
  }

  return res.json();
}

function isUnknownFieldError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("UNKNOWN_FIELD_NAME") ||
    error.message.toLowerCase().includes("unknown field")
  );
}

function withLegacyFieldNames(fields: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const legacy = WRITE_FIELD_ALIASES[key];
    mapped[legacy ?? key] = value;
  }
  return mapped;
}

async function createRecordWithFallback<T extends Record<string, unknown>>(
  table: string,
  fields: T
) {
  try {
    return await createRecord(table, fields);
  } catch (error) {
    if (!isUnknownFieldError(error)) {
      throw error;
    }
    return createRecord(table, withLegacyFieldNames(fields) as T);
  }
}

async function updateRecordWithFallback<T extends Record<string, unknown>>(
  table: string,
  id: string,
  fields: T
) {
  try {
    return await updateRecord(table, id, fields);
  } catch (error) {
    if (!isUnknownFieldError(error)) {
      throw error;
    }
    return updateRecord(table, id, withLegacyFieldNames(fields) as T);
  }
}

export function escapeFormula(value: string) {
  return value.replace(/'/g, "\\'");
}

export async function listAllRecords<T>(table: string, params?: URLSearchParams) {
  const records: AirtableRecord<T>[] = [];
  let offset: string | undefined;

  do {
    const urlParams = new URLSearchParams(params);
    if (offset) {
      urlParams.set("offset", offset);
    }
    const query = urlParams.toString();
    const data = await airtableFetch(`${table}${query ? `?${query}` : ""}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

export async function createRecord<T>(table: string, fields: T) {
  const data = await airtableFetch(table, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] })
  });
  return data.records?.[0] as AirtableRecord<T>;
}

export async function createRecords<T>(table: string, records: T[]) {
  const chunks: T[][] = [];
  for (let i = 0; i < records.length; i += 10) {
    chunks.push(records.slice(i, i + 10));
  }

  const created: AirtableRecord<T>[] = [];
  for (const chunk of chunks) {
    try {
      const data = await airtableFetch(table, {
        method: "POST",
        body: JSON.stringify({
          records: chunk.map((fields) => ({ fields }))
        })
      });
      created.push(...(data.records ?? []));
    } catch (error) {
      if (!isUnknownFieldError(error)) {
        throw error;
      }
      const legacyChunk = chunk.map((fields) =>
        withLegacyFieldNames(fields as Record<string, unknown>)
      );
      const data = await airtableFetch(table, {
        method: "POST",
        body: JSON.stringify({
          records: legacyChunk.map((fields) => ({ fields }))
        })
      });
      created.push(...(data.records ?? []));
    }
  }
  return created;
}

export async function updateRecord<T>(table: string, id: string, fields: T) {
  const data = await airtableFetch(`${table}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
  return data as AirtableRecord<T>;
}

export async function deleteRecord(table: string, id: string) {
  const data = await airtableFetch(`${table}/${id}`, {
    method: "DELETE"
  });
  return data as { id: string; deleted: boolean };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function recordWithCreatedDateTime<T extends Record<string, unknown>>(
  record: AirtableRecord<T>,
  createdAtField: string
) {
  return {
    ...record,
    createdDateTime: readField(record.fields as Record<string, unknown>, createdAtField) || record.createdTime
  };
}

async function resolveRecordId(
  table: string,
  rowId: string,
  lookupField?: string
) {
  try {
    const direct = await airtableFetch(`${table}/${rowId}`);
    return direct.id as string;
  } catch {
    if (!lookupField) {
      throw new Error("Record not found.");
    }
    const records = await listAllRecords<Record<string, unknown>>(table);
    const found = records.find((record) => {
      const fields = record.fields as Record<string, unknown>;
      return readField(fields, lookupField) === rowId;
    });
    if (!found) {
      throw new Error("Record not found.");
    }
    return found.id;
  }
}

export async function isAdminEmail(email: string) {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.admins);
  return records.some((record) => {
    const fields = record.fields as Record<string, unknown>;
    return normalizeEmail(readField(fields, "Email")) === normalizeEmail(email);
  });
}

export async function getAdminSettings() {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.settings);
  const record = records[0];
  const fields = (record?.fields ?? {}) as Record<string, unknown>;
  return {
    id: record?.id ?? null,
    centralAdminEmail: readField(fields, "CentralAdminEmail"),
    adminNotifyRecipients: readField(fields, "AdminNotifyRecipients")
  };
}

export async function upsertAdminSettings(settings: {
  centralAdminEmail: string;
  adminNotifyRecipients: string;
}) {
  const existing = await getAdminSettings();
  const fields = {
    CentralAdminEmail: settings.centralAdminEmail,
    AdminNotifyRecipients: settings.adminNotifyRecipients
  };

  if (existing.id) {
    await updateRecordWithFallback(TABLES.settings, existing.id, fields);
    return { id: existing.id, ...fields };
  }

  const created = await createRecordWithFallback(TABLES.settings, fields);
  return { id: created.id, ...created.fields };
}

export async function getHierarchyRows() {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.reference);

  return records
    .filter((record) => {
      const fields = record.fields as Record<string, unknown>;
      return readBoolField(fields, "IsActive", true);
    })
    .map((record) => {
      const fields = record.fields as Record<string, unknown>;
      return {
        Region: readField(fields, "Region"),
        Subsidiary: readField(fields, "Subsidiary"),
        Branch: readField(fields, "Branch")
      };
    })
    .filter((row) => row.Region && row.Subsidiary && row.Branch);
}

export async function getRequestRecord(rowId: string) {
  const recordId = await resolveRecordId(TABLES.requests, rowId, "RequestId");
  const record = (await airtableFetch(
    `${TABLES.requests}/${recordId}`
  )) as AirtableRecord<Record<string, unknown>>;
  const normalized = normalizeRequestFields(record.fields);
  return recordWithCreatedDateTime(
    {
      ...record,
      fields: normalized
    },
    "CreatedAt"
  );
}

export async function getRequestById(id: string) {
  return getRequestRecord(id);
}

export async function listRequestsByEmail(email: string) {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.requests);
  return records
    .map((record) => ({
      ...record,
      fields: normalizeRequestFields(record.fields)
    }))
    .filter(
      (record) =>
        normalizeEmail(record.fields.RequesterEmail || "") === normalizeEmail(email)
    )
    .sort((a, b) => (b.fields.CreatedAt || "").localeCompare(a.fields.CreatedAt || ""))
    .map((record) => recordWithCreatedDateTime(record, "CreatedAt"));
}

export async function listAllRequests() {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.requests);
  return records
    .map((record) => ({
      ...record,
      fields: normalizeRequestFields(record.fields)
    }))
    .sort((a, b) => (b.fields.CreatedAt || "").localeCompare(a.fields.CreatedAt || ""))
    .map((record) => recordWithCreatedDateTime(record, "CreatedAt"));
}

export async function listActiveAccess() {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.activeAccess);
  return records
    .map((record) => ({
      ...record,
      fields: normalizeActiveAccessFields(record.fields)
    }))
    .sort((a, b) => (b.fields.ActivatedAt || "").localeCompare(a.fields.ActivatedAt || ""))
    .map((record) => recordWithCreatedDateTime(record, "ActivatedAt"));
}

export async function getActiveAccessRecord(rowId: string) {
  const recordId = await resolveRecordId(
    TABLES.activeAccess,
    rowId,
    "SourceRequestId"
  );
  const record = (await airtableFetch(
    `${TABLES.activeAccess}/${recordId}`
  )) as AirtableRecord<Record<string, unknown>>;
  const normalized = normalizeActiveAccessFields(record.fields);
  return recordWithCreatedDateTime(
    {
      ...record,
      fields: normalized
    },
    "ActivatedAt"
  );
}

export async function countActiveAccess(branch: string, access: string) {
  const records = await listActiveAccess();
  return records.filter(
    (record) =>
      record.fields.Branch === branch && record.fields.AirtableAccess === access
  ).length;
}

export async function countPendingRequests(branch: string, access: string) {
  const records = await listAllRequests();
  return records.filter(
    (record) =>
      record.fields.Branch === branch &&
      record.fields.AirtableAccess === access &&
      ["Request Submitted", "Pending"].includes(record.fields.Status || "") &&
      (record.fields.RequestType || "New Access") !== "Access Update"
  ).length;
}

export async function hasDuplicateRequest(email: string, branch: string, access: string) {
  const activeRecords = await listActiveAccess();
  const existsInActive = activeRecords.some(
    (record) =>
      normalizeEmail(record.fields.Email || "") === normalizeEmail(email) &&
      record.fields.Branch === branch &&
      record.fields.AirtableAccess === access
  );

  if (existsInActive) {
    return true;
  }

  const requestRecords = await listAllRequests();
  return requestRecords.some(
    (record) =>
      normalizeEmail(record.fields.RequesterEmail || "") === normalizeEmail(email) &&
      record.fields.Branch === branch &&
      record.fields.AirtableAccess === access &&
      ["Request Submitted", "Pending"].includes(record.fields.Status || "") &&
      (record.fields.RequestType || "New Access") !== "Access Update"
  );
}

export async function hasDuplicateAccessUpdate(
  email: string,
  branch: string,
  requestedAccess: string
) {
  const requestRecords = await listAllRequests();
  return requestRecords.some(
    (record) =>
      normalizeEmail(record.fields.RequesterEmail || "") === normalizeEmail(email) &&
      record.fields.Branch === branch &&
      record.fields.RequestType === "Access Update" &&
      record.fields.RequestedAccess === requestedAccess &&
      ["Request Submitted", "Pending"].includes(record.fields.Status || "")
  );
}

export async function hasActiveAccess(email: string, branch: string, access: string) {
  const activeRecords = await listActiveAccess();
  return activeRecords.some(
    (record) =>
      normalizeEmail(record.fields.Email || "") === normalizeEmail(email) &&
      record.fields.Branch === branch &&
      record.fields.AirtableAccess === access
  );
}

export async function isAdminPasswordValid(password: string) {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  return expected && password === expected;
}

export async function listAdminUsers() {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.admins);
  return records.map((record) => ({
    ...record,
    fields: {
      Email: readField(record.fields as Record<string, unknown>, "Email"),
      Role: readField(record.fields as Record<string, unknown>, "Role")
    }
  }));
}

export async function createRequestRecord(fields: {
  RequestType?: string;
  Region: string;
  Subsidiary: string;
  Branch: string;
  Name: string;
  Position: string;
  RR: string;
  RequesterEmail: string;
  AirtableAccess: string;
  CurrentAccess?: string;
  RequestedAccess?: string;
  ChangeReason?: string;
  Status: string;
}) {
  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const payload = {
    RequestId: requestId,
    RequestType: fields.RequestType ?? "New Access",
    Region: fields.Region,
    Subsidiary: fields.Subsidiary,
    Branch: fields.Branch,
    Name: fields.Name,
    Position: fields.Position,
    RR: fields.RR,
    RequesterEmail: normalizeEmail(fields.RequesterEmail),
    AirtableAccess: fields.AirtableAccess,
    CurrentAccess: fields.CurrentAccess ?? "",
    RequestedAccess: fields.RequestedAccess ?? "",
    ChangeReason: fields.ChangeReason ?? "",
    Status: fields.Status,
    AdminComment: "",
    CreatedAt: now,
    UpdatedAt: now
  };

  const created = await createRecordWithFallback(TABLES.requests, payload);
  return { id: created.id, requestId };
}

export async function updateRequestRecord(rowId: string, fields: Record<string, unknown>) {
  const record = await getRequestRecord(rowId);
  if (!record) {
    throw new Error("Request not found.");
  }

  const previous = { ...record.fields };
  const merged = { ...record.fields } as Record<string, string>;

  Object.entries(fields).forEach(([key, value]) => {
    merged[key] = value ? String(value) : "";
  });

  if (merged.RR && !merged["R&R"]) {
    merged["R&R"] = merged.RR;
  }
  if (merged["R&R"] && !merged.RR) {
    merged.RR = merged["R&R"];
  }
  merged.UpdatedAt = new Date().toISOString();

  await updateRecordWithFallback(TABLES.requests, record.id, merged);
  return { id: record.id, fields: merged, previous };
}

export async function deleteRequestRecord(rowId: string) {
  const record = await getRequestRecord(rowId);
  if (!record) {
    throw new Error("Request not found.");
  }

  await deleteRecord(TABLES.requests, record.id);
  return { id: record.id, fields: record.fields };
}

export async function logDeletedRequest(
  fields: Record<string, string>,
  reason: string,
  requestId?: string
) {
  const now = new Date().toISOString();
  const payload = {
    RequestId: requestId ?? fields.RequestId ?? "",
    RequestType: fields.RequestType ?? "New Access",
    Region: fields.Region ?? "",
    Subsidiary: fields.Subsidiary ?? "",
    Branch: fields.Branch ?? "",
    Name: fields.Name ?? "",
    Position: fields.Position ?? "",
    RR: fields.RR ?? "",
    RequesterEmail: fields.RequesterEmail ?? "",
    AirtableAccess: fields.AirtableAccess ?? "",
    CurrentAccess: fields.CurrentAccess ?? "",
    RequestedAccess: fields.RequestedAccess ?? "",
    ChangeReason: fields.ChangeReason ?? "",
    Status: fields.Status ?? "",
    AdminComment: fields.AdminComment ?? "",
    CreatedAt: fields.CreatedAt ?? "",
    UpdatedAt: fields.UpdatedAt ?? "",
    DeletedAt: now,
    DeletedReason: reason
  };

  await createRecordWithFallback(TABLES.deletedRequests, payload);
}

export async function deleteActiveAccessRecord(rowId: string) {
  const record = await getActiveAccessRecord(rowId);
  if (!record) {
    throw new Error("Active access record not found.");
  }

  await deleteRecord(TABLES.activeAccess, record.id);
  return { id: record.id, fields: record.fields };
}

export async function logDeletedActiveAccess(
  fields: Record<string, string>,
  reason: string
) {
  const now = new Date().toISOString();
  const payload = {
    Region: fields.Region ?? "",
    Subsidiary: fields.Subsidiary ?? "",
    Branch: fields.Branch ?? "",
    Name: fields.Name ?? "",
    Email: fields.Email ?? "",
    Position: fields.Position ?? "",
    RR: fields.RR ?? "",
    AirtableAccess: fields.AirtableAccess ?? "",
    SourceRequestId: fields.SourceRequestId ?? "",
    ActivatedAt: fields.ActivatedAt ?? "",
    DeletedAt: now,
    DeletedReason: reason
  };

  await createRecordWithFallback(TABLES.deletedActiveAccess, payload);
}

export async function logLoginAttempt(fields: {
  result: "success" | "failed";
  ip?: string;
  userAgent?: string;
  path?: string;
  referer?: string;
  acceptLanguage?: string;
}) {
  const now = new Date().toISOString();
  const payload = {
    Timestamp: now,
    Result: fields.result,
    IP: fields.ip ?? "",
    UserAgent: fields.userAgent ?? "",
    Path: fields.path ?? "",
    Referer: fields.referer ?? "",
    AcceptLanguage: fields.acceptLanguage ?? ""
  };

  await createRecordWithFallback(TABLES.loginAudit, payload);
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
  const payload = {
    Region: fields.Region,
    Subsidiary: fields.Subsidiary,
    Branch: fields.Branch,
    Name: fields.Name,
    Email: normalizeEmail(fields.Email),
    Position: fields.Position,
    RR: fields.RR,
    AirtableAccess: fields.AirtableAccess,
    SourceRequestId: fields.SourceRequestId,
    ActivatedAt: fields.ActivatedAt
  };

  const created = await createRecordWithFallback(TABLES.activeAccess, payload);
  return { id: created.id };
}

export async function updateActiveAccessRecord(
  rowId: string,
  fields: Record<string, unknown>
) {
  const record = await getActiveAccessRecord(rowId);
  if (!record) {
    throw new Error("Active access record not found.");
  }

  const merged = { ...record.fields } as Record<string, string>;
  Object.entries(fields).forEach(([key, value]) => {
    merged[key] = value ? String(value) : "";
  });

  if (merged.RR && !merged["R&R"]) {
    merged["R&R"] = merged.RR;
  }
  if (merged["R&R"] && !merged.RR) {
    merged.RR = merged["R&R"];
  }

  await updateRecordWithFallback(TABLES.activeAccess, record.id, merged);
  return { id: record.id, fields: merged };
}

function hashOtp(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function createAccessOtp(recordId: string, email: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 150 * 1000).toISOString();
  const code = generateOtp();

  const payload = {
    RecordId: recordId,
    Email: normalizeEmail(email),
    CodeHash: hashOtp(code),
    ExpiresAt: expiresAt,
    CreatedAt: now.toISOString(),
    Attempts: "0",
    UsedAt: "",
    LastSentAt: now.toISOString()
  };

  await createRecordWithFallback(TABLES.accessOtp, payload);
  return { code, expiresAt };
}

export async function verifyAccessOtp(
  recordId: string,
  email: string,
  code: string
) {
  const records = await listAllRecords<Record<string, unknown>>(TABLES.accessOtp);
  const candidates = records
    .map((record) => ({
      ...record,
      fields: normalizeOtpFields(record.fields)
    }))
    .filter(
      (record) =>
        record.fields.RecordId === recordId &&
        normalizeEmail(record.fields.Email || "") === normalizeEmail(email) &&
        !record.fields.UsedAt
    )
    .sort((a, b) => (b.fields.CreatedAt || "").localeCompare(a.fields.CreatedAt || ""));

  const latest = candidates[0];
  if (!latest) {
    return { ok: false, reason: "missing" as const };
  }

  const expiresAt = latest.fields.ExpiresAt;
  if (expiresAt && Date.now() > new Date(expiresAt).getTime()) {
    return { ok: false, reason: "expired" as const };
  }

  const attempts = Number(latest.fields.Attempts || "0");
  if (hashOtp(code) !== latest.fields.CodeHash) {
    const nextAttempts = attempts + 1;
    await updateRecordWithFallback(TABLES.accessOtp, latest.id, {
      Attempts: String(nextAttempts)
    });
    return {
      ok: false,
      reason: "invalid" as const,
      attemptsLeft: Math.max(0, 5 - nextAttempts)
    };
  }

  await updateRecordWithFallback(TABLES.accessOtp, latest.id, {
    UsedAt: new Date().toISOString()
  });
  return { ok: true };
}

export async function createReferenceRows(
  records: {
    Region: string;
    Subsidiary: string;
    Branch: string;
    IsActive: boolean;
  }[]
) {
  const rows = records.map((record) => ({
    Region: record.Region,
    Subsidiary: record.Subsidiary,
    Branch: record.Branch,
    IsActive: record.IsActive
  }));

  if (rows.length === 0) return;
  await createRecords(TABLES.reference, rows);
}

export async function createActiveAccessRows(
  records: {
    Region: string;
    Subsidiary: string;
    Branch: string;
    Name: string;
    Email?: string;
    Position?: string;
    RR?: string;
    AirtableAccess: string;
  }[]
) {
  const rows = records.map((record) => ({
    Region: record.Region,
    Subsidiary: record.Subsidiary,
    Branch: record.Branch,
    Name: record.Name,
    Email: record.Email ?? "",
    Position: record.Position ?? "",
    RR: record.RR ?? "",
    AirtableAccess: record.AirtableAccess,
    SourceRequestId: "",
    ActivatedAt: ""
  }));

  if (rows.length === 0) return;
  await createRecords(TABLES.activeAccess, rows);
}

export function mapRequestForExport(fields: Record<string, string>) {
  return {
    "Request Type": fields.RequestType ?? "New Access",
    Region: fields.Region ?? "",
    Subsidiary: fields.Subsidiary ?? "",
    Branch: fields.Branch ?? "",
    Name: fields.Name ?? "",
    Position: fields.Position ?? "",
    "R&R": fields.RR ?? "",
    "Requester Email": fields.RequesterEmail ?? "",
    "Airtable Access": fields.AirtableAccess ?? "",
    "Current Access": fields.CurrentAccess ?? "",
    "Requested Access": fields.RequestedAccess ?? "",
    "Change Reason": fields.ChangeReason ?? "",
    Status: fields.Status ?? "",
    "Admin Comment": fields.AdminComment ?? "",
    Created: fields.CreatedAt ?? ""
  };
}

export function mapActiveForExport(fields: Record<string, string>) {
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
  access: z.enum(["Viewer", "Editor"]),
  email: z.string().email()
});

export const accessUpdateSchema = z.object({
  region: z.string().min(1),
  subsidiary: z.string().min(1),
  branch: z.string().min(1),
  name: z.string().min(1),
  position: z.string().min(1),
  rr: z.string().min(1),
  email: z.string().email(),
  currentAccess: z.enum(["Viewer", "Editor", "Related mail recipient"]),
  requestedAccess: z.enum([
    "Viewer",
    "Editor",
    "Related mail recipient",
    "Remove access"
  ]),
  changeReason: z.string().optional()
});

export { TABLES };
