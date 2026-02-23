import "dotenv/config";
import * as XLSX from "xlsx";
import {
  createActiveAccessRows,
  createReferenceRows
} from "../lib/store";

const filePath =
  process.argv[2] ??
  "/Users/janghyuk.suh/Downloads/Airtable Contact List_D2C Creative Hub_260203.xlsx";

const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

function findHeaderRow() {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const row = rows[i] ?? [];
    const joined = row.join(" ");
    if (/Region/i.test(joined)) {
      return i;
    }
  }
  return 0;
}

const headerRowIndex = findHeaderRow();
const headerRow = rows[headerRowIndex] ?? [];
const headerMap = new Map<string, number>();
headerRow.forEach((cell, idx) => {
  if (!cell) return;
  headerMap.set(String(cell).trim().toLowerCase(), idx);
});

function colIndex(...names: string[]) {
  for (const name of names) {
    const idx = headerMap.get(name.toLowerCase());
    if (idx !== undefined) return idx;
  }
  return -1;
}

const regionIdx = colIndex("지역/Region", "region");
const subsidiaryIdx = colIndex("법인/Subsidiary", "subsidiary");
const branchIdx = colIndex("지역/Branch", "branch", "country");
const nameIdx = colIndex("이름/Name", "name");
const accessIdx = colIndex("Airtable", "airtable", "Airtable Access");
const positionIdx = colIndex("직급/Position", "position");
const rrIdx = colIndex("직무/R&R", "r&r", "role");
const emailIdx = colIndex("E-mail", "Email", "E-mail Add", "email");

if ([regionIdx, subsidiaryIdx, branchIdx, nameIdx, accessIdx].some((i) => i < 0)) {
  console.error("Unable to detect required columns. Please check headers.");
  process.exit(1);
}

const hierarchySet = new Set<string>();
const hierarchyRecords: Array<{ Region: string; Subsidiary: string; Branch: string; IsActive: boolean }> = [];
const activeRecords: Array<{
  Region: string;
  Subsidiary: string;
  Branch: string;
  Name: string;
  Email?: string;
  Position?: string;
  RR?: string;
  AirtableAccess: string;
}> = [];

let lastRegion = "";
let lastSubsidiary = "";
let lastBranch = "";

for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
  const row = rows[i] ?? [];
  const regionRaw = String(row[regionIdx] ?? "").trim();
  const subsidiaryRaw = String(row[subsidiaryIdx] ?? "").trim();
  const branchRaw = String(row[branchIdx] ?? "").trim();

  const region = regionRaw || lastRegion;
  const subsidiary = subsidiaryRaw || lastSubsidiary;
  const branch = branchRaw || lastBranch;

  if (region) lastRegion = region;
  if (subsidiary) lastSubsidiary = subsidiary;
  if (branch) lastBranch = branch;

  const name = String(row[nameIdx] ?? "").trim();
  const accessRaw = String(row[accessIdx] ?? "").trim();
  const position = positionIdx >= 0 ? String(row[positionIdx] ?? "").trim() : "";
  const rr = rrIdx >= 0 ? String(row[rrIdx] ?? "").trim() : "";
  const email = emailIdx >= 0 ? String(row[emailIdx] ?? "").trim() : "";

  if (!region || !subsidiary || !branch) continue;

  const key = `${region}||${subsidiary}||${branch}`;
  if (!hierarchySet.has(key)) {
    hierarchySet.add(key);
    hierarchyRecords.push({
      Region: region,
      Subsidiary: subsidiary,
      Branch: branch,
      IsActive: true
    });
  }

  const accessNorm = accessRaw.toLowerCase();
  let access = "";
  if (accessNorm === "viewer") access = "Viewer";
  if (accessNorm === "access granted" || accessNorm === "editor") access = "Editor";
  if (accessNorm === "related mail recipient") access = "Related mail recipient";

  if (access) {
    activeRecords.push({
      Region: region,
      Subsidiary: subsidiary,
      Branch: branch,
      Name: name,
      Email: email || undefined,
      Position: position || undefined,
      RR: rr || undefined,
      AirtableAccess: access
    });
  }
}

const shouldUpload = process.argv.includes("--upload");

console.log(`Hierarchy rows: ${hierarchyRecords.length}`);
console.log(`Active access rows: ${activeRecords.length}`);

if (!shouldUpload) {
  console.log("Dry run complete. Use --upload to send records to Google Sheets.");
  process.exit(0);
}

async function upload() {
  await createReferenceRows(hierarchyRecords);
  await createActiveAccessRows(activeRecords);
  console.log("Upload complete.");
}

upload().catch((error) => {
  console.error("Upload failed", error);
  process.exit(1);
});
