import { google } from "googleapis";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { z } from "zod";

const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE ?? "";
const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
const spreadsheetId = process.env.GOOGLE_SHEET_ID ?? "";

const SHEETS = {
  requests: {
    name: process.env.GS_SHEET_REQUESTS ?? "Requests",
    headers: [
      "RequestId",
      "RequestType",
      "Region",
      "Subsidiary",
      "Branch",
      "Name",
      "Position",
      "R&R",
      "RequesterEmail",
      "AirtableAccess",
      "CurrentAccess",
      "RequestedAccess",
      "ChangeReason",
      "Status",
      "AdminComment",
      "CreatedAt",
      "UpdatedAt"
    ]
  },
  activeAccess: {
    name: process.env.GS_SHEET_ACTIVE_ACCESS ?? "ActiveAccess",
    headers: [
      "Region",
      "Subsidiary",
      "Branch",
      "Name",
      "Email",
      "Position",
      "R&R",
      "AirtableAccess",
      "SourceRequestId",
      "ActivatedAt"
    ]
  },
  reference: {
    name: process.env.GS_SHEET_REFERENCE ?? "ReferenceHierarchy",
    headers: ["Region", "Subsidiary", "Branch", "IsActive"]
  },
  admins: {
    name: process.env.GS_SHEET_ADMINS ?? "AdminUsers",
    headers: ["Email", "Role"]
  },
  settings: {
    name: process.env.GS_SHEET_SETTINGS ?? "AdminSettings",
    headers: ["CentralAdminEmail", "AdminNotifyRecipients"]
  },
  deletedRequests: {
    name: process.env.GS_SHEET_DELETED ?? "DeletedRequests",
    headers: [
      "RequestId",
      "Region",
      "Subsidiary",
      "Branch",
      "Name",
      "Position",
      "R&R",
      "RequesterEmail",
      "AirtableAccess",
      "Status",
      "AdminComment",
      "CreatedAt",
      "UpdatedAt",
      "DeletedAt",
      "DeletedReason"
    ]
  },
  deletedActiveAccess: {
    name: process.env.GS_SHEET_DELETED_ACTIVE ?? "DeletedActiveAccess",
    headers: [
      "Region",
      "Subsidiary",
      "Branch",
      "Name",
      "Email",
      "Position",
      "R&R",
      "AirtableAccess",
      "SourceRequestId",
      "ActivatedAt",
      "DeletedAt",
      "DeletedReason"
    ]
  },
  accessOtp: {
    name: process.env.GS_SHEET_ACCESS_OTP ?? "AccessOtp",
    headers: [
      "RecordId",
      "Email",
      "CodeHash",
      "ExpiresAt",
      "CreatedAt",
      "Attempts",
      "UsedAt",
      "LastSentAt"
    ]
  },
  loginAudit: {
    name: process.env.GS_SHEET_LOGIN_AUDIT ?? "LoginAudit",
    headers: [
      "Timestamp",
      "Result",
      "IP",
      "UserAgent",
      "Path",
      "Referer",
      "AcceptLanguage"
    ]
  }
};

function getAuth() {
  if (keyJson) {
    let credentials: Record<string, unknown>;
    try {
      const raw =
        keyJson.trim().startsWith("{") ? keyJson : Buffer.from(keyJson, "base64").toString("utf-8");
      credentials = JSON.parse(raw);
    } catch (error) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
      ]
    });
  }

  if (!keyFilePath) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEYFILE is missing.");
  }
  const resolved = path.resolve(keyFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Service account key not found: ${resolved}`);
  }
  return new google.auth.GoogleAuth({
    keyFile: resolved,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: "v3", auth });
}

function ensureSpreadsheetId() {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

type SheetRow = {
  id: string;
  rowIndex: number;
  fields: Record<string, string>;
  createdDateTime?: string;
};

async function getSheetValues(sheetName: string) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ensureSpreadsheetId(),
    range: `${sheetName}!A:Z`
  });
  return res.data.values ?? [];
}

export async function getRawSheetValues(sheetName: string) {
  return getSheetValues(sheetName);
}

async function appendRows(sheetName: string, rows: string[][]) {
  if (rows.length === 0) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: ensureSpreadsheetId(),
    range: `${sheetName}!A:Z`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows
    }
  });
}

async function updateRow(sheetName: string, rowIndex: number, row: string[]) {
  const sheets = await getSheetsClient();
  const range = `${sheetName}!A${rowIndex}:Z${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: ensureSpreadsheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] }
  });
}

async function ensureSheet(sheetName: string, headers: string[]) {
  const sheets = await getSheetsClient();
  const id = ensureSpreadsheetId();
  const res = await sheets.spreadsheets.get({ spreadsheetId: id });
  const exists = res.data.sheets?.some(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });
  }

  const values = await getSheetValues(sheetName);
  const firstRow = values[0] ?? [];
  const needsHeader =
    firstRow.length === 0 ||
    headers.some((header, idx) => firstRow[idx] !== header);
  if (needsHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${sheetName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers] }
    });
  }
}

async function getSheetIdByName(sheetName: string) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: ensureSpreadsheetId()
  });
  const sheet = res.data.sheets?.find(
    (item) => item.properties?.title === sheetName
  );
  const id = sheet?.properties?.sheetId;
  if (id === undefined || id === null) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }
  return id;
}

async function deleteRow(sheetName: string, rowIndex: number) {
  const sheets = await getSheetsClient();
  const sheetId = await getSheetIdByName(sheetName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ensureSpreadsheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex
            }
          }
        }
      ]
    }
  });
}

function rowsToObjects(values: string[][]) {
  if (values.length === 0) return { headers: [], rows: [] as SheetRow[] };
  const headers = values[0].map((value) => String(value || "").trim());
  const rows: SheetRow[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!row || row.length === 0 || row.every((cell) => !cell)) {
      continue;
    }
    const fields: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const value = row[idx] ? String(row[idx]) : "";
      fields[header] = value;
      if (header === "R&R") {
        fields.RR = value;
      }
    });
    rows.push({
      id: fields.RequestId || `${i + 1}`,
      rowIndex: i + 1,
      fields,
      createdDateTime: fields.CreatedAt
    });
  }
  return { headers, rows };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function createSpreadsheet(ownerEmail: string) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: "Access Request App"
      },
      sheets: Object.values(SHEETS).map((sheet) => ({
        properties: { title: sheet.name }
      }))
    }
  });

  const id = res.data.spreadsheetId as string;
  if (!id) throw new Error("Failed to create spreadsheet.");

  const headerWrites = Object.values(SHEETS).map((sheet) => ({
    range: `${sheet.name}!A1`,
    values: [sheet.headers]
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: headerWrites
    }
  });

  const drive = await getDriveClient();
  await drive.permissions.create({
    fileId: id,
    requestBody: {
      type: "user",
      role: "writer",
      emailAddress: ownerEmail
    }
  });

  return id;
}

export async function getHierarchyRows() {
  const values = await getSheetValues(SHEETS.reference.name);
  const { rows } = rowsToObjects(values);
  return rows
    .filter((row) => String(row.fields.IsActive || "").toLowerCase() !== "false")
    .map((row) => ({
      Region: row.fields.Region ?? "",
      Subsidiary: row.fields.Subsidiary ?? "",
      Branch: row.fields.Branch ?? ""
    }))
    .filter((row) => row.Region && row.Subsidiary && row.Branch);
}

export async function listRequestsByEmail(email: string) {
  const values = await getSheetValues(SHEETS.requests.name);
  const { rows } = rowsToObjects(values);
  return rows
    .filter((row) => normalizeEmail(row.fields.RequesterEmail) === normalizeEmail(email))
    .sort((a, b) => (b.fields.CreatedAt || "").localeCompare(a.fields.CreatedAt || ""));
}

export async function listAllRequests() {
  const values = await getSheetValues(SHEETS.requests.name);
  const { rows } = rowsToObjects(values);
  return rows.sort((a, b) => (b.fields.CreatedAt || "").localeCompare(a.fields.CreatedAt || ""));
}

export async function listActiveAccess() {
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { rows } = rowsToObjects(values);
  return rows.sort((a, b) => (b.fields.ActivatedAt || "").localeCompare(a.fields.ActivatedAt || ""));
}

export async function getActiveAccessRecord(rowId: string) {
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { rows } = rowsToObjects(values);
  const row = rows.find((r) => r.id === rowId || `${r.rowIndex}` === rowId);
  if (!row) return null;
  return row;
}

export async function getRequestRecord(rowId: string) {
  const values = await getSheetValues(SHEETS.requests.name);
  const { rows } = rowsToObjects(values);
  const row = rows.find((r) => r.id === rowId || `${r.rowIndex}` === rowId);
  if (!row) return null;
  return row;
}

export async function countActiveAccess(branch: string, access: string) {
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { rows } = rowsToObjects(values);
  return rows.filter(
    (row) => row.fields.Branch === branch && row.fields.AirtableAccess === access
  ).length;
}

export async function countPendingRequests(branch: string, access: string) {
  const values = await getSheetValues(SHEETS.requests.name);
  const { rows } = rowsToObjects(values);
  return rows.filter(
    (row) =>
      row.fields.Branch === branch &&
      row.fields.AirtableAccess === access &&
      ["Request Submitted", "Pending"].includes(row.fields.Status) &&
      (row.fields.RequestType ?? "New Access") !== "Access Update"
  ).length;
}

export async function hasDuplicateRequest(email: string, branch: string, access: string) {
  const valuesActive = await getSheetValues(SHEETS.activeAccess.name);
  const { rows: activeRows } = rowsToObjects(valuesActive);
  const inActive = activeRows.some(
    (row) =>
      normalizeEmail(row.fields.Email || "") === normalizeEmail(email) &&
      row.fields.Branch === branch &&
      row.fields.AirtableAccess === access
  );
  if (inActive) return true;

  const valuesReq = await getSheetValues(SHEETS.requests.name);
  const { rows: reqRows } = rowsToObjects(valuesReq);
  return reqRows.some(
    (row) =>
      normalizeEmail(row.fields.RequesterEmail || "") === normalizeEmail(email) &&
      row.fields.Branch === branch &&
      row.fields.AirtableAccess === access &&
      ["Request Submitted", "Pending"].includes(row.fields.Status) &&
      (row.fields.RequestType ?? "New Access") !== "Access Update"
  );
}

export async function hasDuplicateAccessUpdate(
  email: string,
  branch: string,
  requestedAccess: string
) {
  const valuesReq = await getSheetValues(SHEETS.requests.name);
  const { rows: reqRows } = rowsToObjects(valuesReq);
  return reqRows.some(
    (row) =>
      normalizeEmail(row.fields.RequesterEmail || "") === normalizeEmail(email) &&
      row.fields.Branch === branch &&
      row.fields.RequestType === "Access Update" &&
      row.fields.RequestedAccess === requestedAccess &&
      ["Request Submitted", "Pending"].includes(row.fields.Status)
  );
}

export async function hasActiveAccess(email: string, branch: string, access: string) {
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { rows } = rowsToObjects(values);
  return rows.some(
    (row) =>
      normalizeEmail(row.fields.Email || "") === normalizeEmail(email) &&
      row.fields.Branch === branch &&
      row.fields.AirtableAccess === access
  );
}

export async function isAdminPasswordValid(password: string) {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  return expected && password === expected;
}

export async function getAdminSettings() {
  const values = await getSheetValues(SHEETS.settings.name);
  const { rows } = rowsToObjects(values);
  const first = rows[0]?.fields ?? {};
  return {
    id: rows[0]?.id ?? null,
    centralAdminEmail: first.CentralAdminEmail ?? "",
    adminNotifyRecipients: first.AdminNotifyRecipients ?? ""
  };
}

export async function upsertAdminSettings(settings: {
  centralAdminEmail: string;
  adminNotifyRecipients: string;
}) {
  const values = await getSheetValues(SHEETS.settings.name);
  const { headers, rows } = rowsToObjects(values);
  const rowValues = headers.map((header) => {
    if (header === "CentralAdminEmail") return settings.centralAdminEmail;
    if (header === "AdminNotifyRecipients") return settings.adminNotifyRecipients;
    return "";
  });

  if (rows.length > 0) {
    await updateRow(SHEETS.settings.name, rows[0].rowIndex, rowValues);
    return { id: rows[0].id, ...settings };
  }

  await appendRows(SHEETS.settings.name, [rowValues]);
  return { id: "1", ...settings };
}

export async function listAdminUsers() {
  const values = await getSheetValues(SHEETS.admins.name);
  const { rows } = rowsToObjects(values);
  return rows;
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
  await ensureSheet(SHEETS.requests.name, SHEETS.requests.headers);
  const values = await getSheetValues(SHEETS.requests.name);
  const { headers } = rowsToObjects(values);
  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const requesterEmail = normalizeEmail(fields.RequesterEmail);
  const rowValues = headers.map((header) => {
    switch (header) {
      case "RequestId":
        return requestId;
      case "RequestType":
        return fields.RequestType ?? "New Access";
      case "Region":
        return fields.Region;
      case "Subsidiary":
        return fields.Subsidiary;
      case "Branch":
        return fields.Branch;
      case "Name":
        return fields.Name;
      case "Position":
        return fields.Position;
      case "RR":
      case "R&R":
        return fields.RR;
      case "RequesterEmail":
        return requesterEmail;
      case "AirtableAccess":
        return fields.AirtableAccess;
      case "CurrentAccess":
        return fields.CurrentAccess ?? "";
      case "RequestedAccess":
        return fields.RequestedAccess ?? "";
      case "ChangeReason":
        return fields.ChangeReason ?? "";
      case "Status":
        return fields.Status;
      case "AdminComment":
        return "";
      case "CreatedAt":
        return now;
      case "UpdatedAt":
        return now;
      default:
        return "";
    }
  });

  await appendRows(SHEETS.requests.name, [rowValues]);
  return { id: requestId };
}

export async function updateRequestRecord(rowId: string, fields: Record<string, unknown>) {
  const values = await getSheetValues(SHEETS.requests.name);
  const { headers, rows } = rowsToObjects(values);
  const row = rows.find((r) => r.id === rowId || `${r.rowIndex}` === rowId);
  if (!row) throw new Error("Request not found.");
  const previous = { ...row.fields };
  const merged = { ...row.fields } as Record<string, string>;
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

  const rowValues = headers.map((header) => merged[header] ?? "");
  await updateRow(SHEETS.requests.name, row.rowIndex, rowValues);
  return { id: row.id, fields: merged, previous };
}

export async function deleteRequestRecord(rowId: string) {
  const values = await getSheetValues(SHEETS.requests.name);
  const { rows } = rowsToObjects(values);
  const row = rows.find((r) => r.id === rowId || `${r.rowIndex}` === rowId);
  if (!row) throw new Error("Request not found.");
  await deleteRow(SHEETS.requests.name, row.rowIndex);
  return { id: row.id, fields: row.fields };
}

export async function logDeletedRequest(
  fields: Record<string, string>,
  reason: string,
  requestId?: string
) {
  await ensureSheet(SHEETS.deletedRequests.name, SHEETS.deletedRequests.headers);
  const values = await getSheetValues(SHEETS.deletedRequests.name);
  const { headers } = rowsToObjects(values);
  const now = new Date().toISOString();
  const rowValues = headers.map((header) => {
    switch (header) {
      case "RequestId":
        return requestId ?? fields.RequestId ?? "";
      case "Region":
        return fields.Region ?? "";
      case "Subsidiary":
        return fields.Subsidiary ?? "";
      case "Branch":
        return fields.Branch ?? "";
      case "Name":
        return fields.Name ?? "";
      case "Position":
        return fields.Position ?? "";
      case "RR":
      case "R&R":
        return fields.RR ?? "";
      case "RequesterEmail":
        return fields.RequesterEmail ?? "";
      case "AirtableAccess":
        return fields.AirtableAccess ?? "";
      case "Status":
        return fields.Status ?? "";
      case "AdminComment":
        return fields.AdminComment ?? "";
      case "CreatedAt":
        return fields.CreatedAt ?? "";
      case "UpdatedAt":
        return fields.UpdatedAt ?? "";
      case "DeletedAt":
        return now;
      case "DeletedReason":
        return reason;
      default:
        return "";
    }
  });
  await appendRows(SHEETS.deletedRequests.name, [rowValues]);
}

export async function deleteActiveAccessRecord(rowId: string) {
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { rows } = rowsToObjects(values);
  const row = rows.find((r) => r.id === rowId || `${r.rowIndex}` === rowId);
  if (!row) throw new Error("Active access record not found.");
  await deleteRow(SHEETS.activeAccess.name, row.rowIndex);
  return { id: row.id, fields: row.fields };
}

export async function logDeletedActiveAccess(
  fields: Record<string, string>,
  reason: string
) {
  await ensureSheet(
    SHEETS.deletedActiveAccess.name,
    SHEETS.deletedActiveAccess.headers
  );
  const values = await getSheetValues(SHEETS.deletedActiveAccess.name);
  const { headers } = rowsToObjects(values);
  const now = new Date().toISOString();
  const rowValues = headers.map((header) => {
    switch (header) {
      case "Region":
        return fields.Region ?? "";
      case "Subsidiary":
        return fields.Subsidiary ?? "";
      case "Branch":
        return fields.Branch ?? "";
      case "Name":
        return fields.Name ?? "";
      case "Email":
        return fields.Email ?? "";
      case "Position":
        return fields.Position ?? "";
      case "R&R":
      case "RR":
        return fields.RR ?? "";
      case "AirtableAccess":
        return fields.AirtableAccess ?? "";
      case "SourceRequestId":
        return fields.SourceRequestId ?? "";
      case "ActivatedAt":
        return fields.ActivatedAt ?? "";
      case "DeletedAt":
        return now;
      case "DeletedReason":
        return reason;
      default:
        return "";
    }
  });
  await appendRows(SHEETS.deletedActiveAccess.name, [rowValues]);
}

export async function logLoginAttempt(fields: {
  result: "success" | "failed";
  ip?: string;
  userAgent?: string;
  path?: string;
  referer?: string;
  acceptLanguage?: string;
}) {
  await ensureSheet(SHEETS.loginAudit.name, SHEETS.loginAudit.headers);
  const values = await getSheetValues(SHEETS.loginAudit.name);
  const { headers } = rowsToObjects(values);
  const now = new Date().toISOString();
  const rowValues = headers.map((header) => {
    switch (header) {
      case "Timestamp":
        return now;
      case "Result":
        return fields.result;
      case "IP":
        return fields.ip ?? "";
      case "UserAgent":
        return fields.userAgent ?? "";
      case "Path":
        return fields.path ?? "";
      case "Referer":
        return fields.referer ?? "";
      case "AcceptLanguage":
        return fields.acceptLanguage ?? "";
      default:
        return "";
    }
  });
  await appendRows(SHEETS.loginAudit.name, [rowValues]);
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
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { headers } = rowsToObjects(values);
  const email = normalizeEmail(fields.Email);
  const rowValues = headers.map((header) => {
    switch (header) {
      case "Region":
        return fields.Region;
      case "Subsidiary":
        return fields.Subsidiary;
      case "Branch":
        return fields.Branch;
      case "Name":
        return fields.Name;
      case "Email":
        return email;
      case "Position":
        return fields.Position;
      case "RR":
      case "R&R":
        return fields.RR;
      case "AirtableAccess":
        return fields.AirtableAccess;
      case "SourceRequestId":
        return fields.SourceRequestId;
      case "ActivatedAt":
        return fields.ActivatedAt;
      default:
        return "";
    }
  });

  await appendRows(SHEETS.activeAccess.name, [rowValues]);
  return { id: fields.SourceRequestId };
}

export async function updateActiveAccessRecord(
  rowId: string,
  fields: Record<string, unknown>
) {
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { headers, rows } = rowsToObjects(values);
  const row = rows.find((r) => r.id === rowId || `${r.rowIndex}` === rowId);
  if (!row) throw new Error("Active access record not found.");
  const merged = { ...row.fields } as Record<string, string>;
  Object.entries(fields).forEach(([key, value]) => {
    merged[key] = value ? String(value) : "";
  });
  if (merged.RR && !merged["R&R"]) {
    merged["R&R"] = merged.RR;
  }
  if (merged["R&R"] && !merged.RR) {
    merged.RR = merged["R&R"];
  }
  const rowValues = headers.map((header) => merged[header] ?? "");
  await updateRow(SHEETS.activeAccess.name, row.rowIndex, rowValues);
  return { id: row.id, fields: merged };
}

function hashOtp(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function createAccessOtp(recordId: string, email: string) {
  await ensureSheet(SHEETS.accessOtp.name, SHEETS.accessOtp.headers);
  const values = await getSheetValues(SHEETS.accessOtp.name);
  const { headers } = rowsToObjects(values);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 150 * 1000).toISOString();
  const code = generateOtp();
  const rowValues = headers.map((header) => {
    switch (header) {
      case "RecordId":
        return recordId;
      case "Email":
        return normalizeEmail(email);
      case "CodeHash":
        return hashOtp(code);
      case "ExpiresAt":
        return expiresAt;
      case "CreatedAt":
        return now.toISOString();
      case "Attempts":
        return "0";
      case "UsedAt":
        return "";
      case "LastSentAt":
        return now.toISOString();
      default:
        return "";
    }
  });
  await appendRows(SHEETS.accessOtp.name, [rowValues]);
  return { code, expiresAt };
}

async function updateOtpRow(rowId: string, updates: Record<string, string>) {
  const values = await getSheetValues(SHEETS.accessOtp.name);
  const { headers, rows } = rowsToObjects(values);
  const row = rows.find((r) => r.id === rowId || `${r.rowIndex}` === rowId);
  if (!row) throw new Error("OTP record not found.");
  const merged = { ...row.fields, ...updates };
  const rowValues = headers.map((header) => merged[header] ?? "");
  await updateRow(SHEETS.accessOtp.name, row.rowIndex, rowValues);
  return merged;
}

export async function verifyAccessOtp(
  recordId: string,
  email: string,
  code: string
) {
  await ensureSheet(SHEETS.accessOtp.name, SHEETS.accessOtp.headers);
  const values = await getSheetValues(SHEETS.accessOtp.name);
  const { rows } = rowsToObjects(values);
  const candidates = rows
    .filter(
      (row) =>
        row.fields.RecordId === recordId &&
        normalizeEmail(row.fields.Email || "") === normalizeEmail(email) &&
        !row.fields.UsedAt
    )
    .sort((a, b) => (b.fields.CreatedAt || "").localeCompare(a.fields.CreatedAt || ""));

  const latest = candidates[0];
  if (!latest) {
    return { ok: false, reason: "missing" as const };
  }

  const expiresAt = latest.fields.ExpiresAt ?? "";
  if (expiresAt && Date.now() > new Date(expiresAt).getTime()) {
    return { ok: false, reason: "expired" as const };
  }

  const attempts = Number(latest.fields.Attempts || "0");
  if (hashOtp(code) !== latest.fields.CodeHash) {
    const nextAttempts = attempts + 1;
    await updateOtpRow(latest.id, { Attempts: String(nextAttempts) });
    return { ok: false, reason: "invalid" as const, attemptsLeft: Math.max(0, 5 - nextAttempts) };
  }

  await updateOtpRow(latest.id, { UsedAt: new Date().toISOString() });
  return { ok: true };
}

export async function createReferenceRows(records: {
  Region: string;
  Subsidiary: string;
  Branch: string;
  IsActive: boolean;
}[]) {
  const values = await getSheetValues(SHEETS.reference.name);
  const { headers } = rowsToObjects(values);
  const rows = records.map((record) =>
    headers.map((header) => {
      if (header === "Region") return record.Region;
      if (header === "Subsidiary") return record.Subsidiary;
      if (header === "Branch") return record.Branch;
      if (header === "IsActive") return record.IsActive ? "true" : "false";
      return "";
    })
  );
  await appendRows(SHEETS.reference.name, rows);
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
  const values = await getSheetValues(SHEETS.activeAccess.name);
  const { headers } = rowsToObjects(values);
  const rows = records.map((record) =>
    headers.map((header) => {
      if (header === "Region") return record.Region;
      if (header === "Subsidiary") return record.Subsidiary;
      if (header === "Branch") return record.Branch;
      if (header === "Name") return record.Name;
      if (header === "Email") return record.Email ?? "";
      if (header === "Position") return record.Position ?? "";
      if (header === "RR" || header === "R&R") return record.RR ?? "";
      if (header === "AirtableAccess") return record.AirtableAccess;
      if (header === "SourceRequestId") return "";
      if (header === "ActivatedAt") return "";
      return "";
    })
  );
  await appendRows(SHEETS.activeAccess.name, rows);
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

export { SHEETS };
