import * as sheets from "./sheets";
import * as airtable from "./airtable";

const configuredBackend = (process.env.DATA_BACKEND ?? "").toLowerCase();
const airtableReady = Boolean(
  process.env.AIRTABLE_BASE_ID && process.env.AIRTABLE_API_KEY
);
const useSheets =
  configuredBackend === "sheets" ||
  (!configuredBackend && !airtableReady);

const db = useSheets ? sheets : airtable;

export const DATA_BACKEND = useSheets ? "sheets" : "airtable";

export const requestSchema = db.requestSchema;
export const accessUpdateSchema = db.accessUpdateSchema;

export const mapRequestForExport = db.mapRequestForExport;
export const mapActiveForExport = db.mapActiveForExport;

export const getHierarchyRows = () => db.getHierarchyRows();
export const listRequestsByEmail = (email: string) => db.listRequestsByEmail(email);
export const listAllRequests = () => db.listAllRequests();
export const listActiveAccess = () => db.listActiveAccess();
export const getActiveAccessRecord = (rowId: string) => db.getActiveAccessRecord(rowId);
export const getRequestRecord = (rowId: string) => db.getRequestRecord(rowId);

export const countActiveAccess = (branch: string, access: string) =>
  db.countActiveAccess(branch, access);
export const countPendingRequests = (branch: string, access: string) =>
  db.countPendingRequests(branch, access);

export const hasDuplicateRequest = (email: string, branch: string, access: string) =>
  db.hasDuplicateRequest(email, branch, access);
export const hasDuplicateAccessUpdate = (
  email: string,
  branch: string,
  requestedAccess: string
) => db.hasDuplicateAccessUpdate(email, branch, requestedAccess);
export const hasActiveAccess = (email: string, branch: string, access: string) =>
  db.hasActiveAccess(email, branch, access);

export const isAdminPasswordValid = (password: string) => db.isAdminPasswordValid(password);
export const getAdminSettings = () => db.getAdminSettings();
export const upsertAdminSettings = (settings: {
  centralAdminEmail: string;
  adminNotifyRecipients: string;
}) => db.upsertAdminSettings(settings);

export const createRequestRecord = (fields: {
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
}) => db.createRequestRecord(fields);

export const updateRequestRecord = (
  rowId: string,
  fields: Record<string, unknown>
) => db.updateRequestRecord(rowId, fields);
export const deleteRequestRecord = (rowId: string) => db.deleteRequestRecord(rowId);

export const logDeletedRequest = (
  fields: Record<string, string>,
  reason: string,
  requestId?: string
) => db.logDeletedRequest(fields, reason, requestId);

export const deleteActiveAccessRecord = (rowId: string) =>
  db.deleteActiveAccessRecord(rowId);
export const logDeletedActiveAccess = (
  fields: Record<string, string>,
  reason: string
) => db.logDeletedActiveAccess(fields, reason);

export const logLoginAttempt = (fields: {
  result: "success" | "failed";
  ip?: string;
  userAgent?: string;
  path?: string;
  referer?: string;
  acceptLanguage?: string;
}) => db.logLoginAttempt(fields);

export const addActiveAccess = (fields: {
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
}) => db.addActiveAccess(fields);

export const updateActiveAccessRecord = (
  rowId: string,
  fields: Record<string, unknown>
) => db.updateActiveAccessRecord(rowId, fields);

export const createAccessOtp = (recordId: string, email: string) =>
  db.createAccessOtp(recordId, email);
export const verifyAccessOtp = (recordId: string, email: string, code: string) =>
  db.verifyAccessOtp(recordId, email, code);

export const createReferenceRows = (
  records: {
    Region: string;
    Subsidiary: string;
    Branch: string;
    IsActive: boolean;
  }[]
) => db.createReferenceRows(records);

export const createActiveAccessRows = (
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
) => db.createActiveAccessRows(records);
