import "dotenv/config";
import { SHEETS, getRawSheetValues } from "../lib/sheets";

const AIRTABLE_BASE_ID = (process.env.AIRTABLE_BASE_ID ?? "").trim();
const AIRTABLE_API_KEY = (process.env.AIRTABLE_API_KEY ?? "").trim();

if (process.env.ALLOW_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

type SheetConfig = {
  name: string;
  headers: string[];
};

type MetaField = {
  id: string;
  name: string;
  type: string;
};

type MetaTable = {
  id: string;
  name: string;
  fields: MetaField[];
};

function getArgs() {
  const args = process.argv.slice(2);
  return {
    upload: args.includes("--upload"),
    replace: args.includes("--replace")
  };
}

function ensureEnv() {
  if (!AIRTABLE_BASE_ID) {
    throw new Error("AIRTABLE_BASE_ID is missing.");
  }
  if (!AIRTABLE_API_KEY) {
    throw new Error("AIRTABLE_API_KEY is missing.");
  }
}

async function airtableFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const detail = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`Airtable API ${res.status} at ${url}: ${detail}`);
  }

  return data as Record<string, unknown>;
}

async function listMetaTables() {
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;
  const data = await airtableFetch(url);
  const tables = (data.tables ?? []) as MetaTable[];
  return tables;
}

async function createMetaTable(tableName: string, headers: string[]) {
  const uniqueHeaders = Array.from(
    new Set(headers.map((h) => h.trim()).filter(Boolean))
  );
  const fields = (uniqueHeaders.length > 0 ? uniqueHeaders : ["Primary"]).map((name) => ({
    name,
    type: "singleLineText"
  }));

  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;
  const data = await airtableFetch(url, {
    method: "POST",
    body: JSON.stringify({
      name: tableName,
      fields
    })
  });

  return data as unknown as MetaTable;
}

async function createMetaField(tableId: string, fieldName: string) {
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables/${tableId}/fields`;
  await airtableFetch(url, {
    method: "POST",
    body: JSON.stringify({
      name: fieldName,
      type: "singleLineText"
    })
  });
}

async function ensureMetaTable(tableName: string, headers: string[]) {
  const tables = await listMetaTables();
  const existing = tables.find((table) => table.name === tableName);

  if (!existing) {
    await createMetaTable(tableName, headers);
    console.log(`Created Airtable table: ${tableName}`);
    return;
  }

  const existingFields = new Set(existing.fields.map((field) => field.name));
  const missing = Array.from(
    new Set(headers.map((h) => h.trim()).filter(Boolean))
  ).filter((header) => !existingFields.has(header));

  for (const fieldName of missing) {
    await createMetaField(existing.id, fieldName);
    console.log(`Added missing field '${fieldName}' to ${tableName}`);
  }
}

function rowToRecord(headers: string[], row: string[]) {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = header.trim();
    if (!key) return;
    record[key] = String(row[index] ?? "");
  });
  return record;
}

async function readSheetData(sheet: SheetConfig) {
  let values: string[][] = [];
  try {
    values = await getRawSheetValues(sheet.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unable to parse range")) {
      return { headers: sheet.headers, records: [] as Record<string, string>[] };
    }
    throw error;
  }
  const headerRow = values[0] ?? [];
  const inferredHeaders =
    headerRow.length > 0
      ? headerRow.map((value) => String(value ?? "").trim())
      : sheet.headers;

  const headers = inferredHeaders.map((h) => h.trim()).filter(Boolean);
  const records = values
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => rowToRecord(headers, row.map((cell) => String(cell ?? ""))));

  return { headers, records };
}

async function listAllRecordIds(tableName: string) {
  const ids: string[] = [];
  let offset = "";

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`
    );
    url.searchParams.set("pageSize", "100");
    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const data = await airtableFetch(url.toString());
    const records = (data.records ?? []) as Array<{ id: string }>;
    ids.push(...records.map((record) => record.id));
    offset = String(data.offset ?? "");
  } while (offset);

  return ids;
}

async function deleteRecords(tableName: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`
    );
    chunk.forEach((id) => url.searchParams.append("records[]", id));
    await airtableFetch(url.toString(), { method: "DELETE" });
  }
}

async function insertRecords(tableName: string, records: Record<string, string>[]) {
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
    await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        records: chunk.map((fields) => ({ fields }))
      })
    });
  }
}

async function main() {
  ensureEnv();

  const { upload, replace } = getArgs();

  const targets: SheetConfig[] = Object.values(SHEETS).map((sheet) => ({
    name: sheet.name,
    headers: sheet.headers
  }));

  const collected: Array<{
    tableName: string;
    headers: string[];
    records: Record<string, string>[];
  }> = [];

  for (const sheet of targets) {
    const data = await readSheetData(sheet);
    collected.push({
      tableName: sheet.name,
      headers: data.headers,
      records: data.records
    });
  }

  console.log("=== Migration Preview ===");
  collected.forEach((item) => {
    console.log(`${item.tableName}: headers=${item.headers.length}, rows=${item.records.length}`);
  });

  if (!upload) {
    console.log("Dry run complete. Add --upload to perform migration.");
    return;
  }

  for (const item of collected) {
    await ensureMetaTable(item.tableName, item.headers);
  }

  for (const item of collected) {
    if (replace) {
      const existingIds = await listAllRecordIds(item.tableName);
      if (existingIds.length > 0) {
        await deleteRecords(item.tableName, existingIds);
      }
      console.log(`Cleared ${existingIds.length} rows from ${item.tableName}`);
    }

    if (item.records.length > 0) {
      await insertRecords(item.tableName, item.records);
    }
    console.log(`Uploaded ${item.records.length} rows to ${item.tableName}`);
  }

  console.log("Migration complete.");
}

main().catch((error) => {
  console.error("Migration failed", error);
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NOT_FOUND")) {
    console.error(
      "Hint: AIRTABLE_BASE_ID is incorrect, or PAT does not have access to that base."
    );
  }
  if (message.includes("SELF_SIGNED_CERT_IN_CHAIN")) {
    console.error(
      "Hint: Corporate TLS interception detected. Retry with ALLOW_INSECURE_TLS=1, or configure trusted CA."
    );
  }
  console.error(
    "Hint: Ensure PAT has data.records:read/write and schema.bases:read/write scopes for this base."
  );
  process.exit(1);
});
