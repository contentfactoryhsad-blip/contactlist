import "dotenv/config";
import { getGraphToken } from "../lib/msgraph";

const siteUrl = process.env.SHAREPOINT_SITE_URL ?? "";
const siteIdOverride = process.env.SHAREPOINT_SITE_ID ?? "";

const LISTS = {
  requests: process.env.SP_LIST_REQUESTS ?? "Requests",
  activeAccess: process.env.SP_LIST_ACTIVE_ACCESS ?? "ActiveAccess",
  reference: process.env.SP_LIST_REFERENCE ?? "ReferenceHierarchy",
  admins: process.env.SP_LIST_ADMINS ?? "AdminUsers",
  settings: process.env.SP_LIST_SETTINGS ?? "AdminSettings"
};

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

async function resolveSiteId() {
  if (siteIdOverride) return siteIdOverride;
  if (!siteUrl) throw new Error("SHAREPOINT_SITE_URL is missing.");
  const url = new URL(siteUrl);
  const host = url.hostname;
  const path = url.pathname.replace(/\/$/, "");
  const data = await graphFetch(`/sites/${host}:${path}`);
  return data.id as string;
}

async function listExists(siteId: string, displayName: string) {
  const data = await graphFetch(
    `/sites/${siteId}/lists?$filter=displayName eq '${displayName}'`
  );
  return data.value?.[0] ?? null;
}

async function createList(siteId: string, displayName: string) {
  const data = await graphFetch(`/sites/${siteId}/lists`, {
    method: "POST",
    body: JSON.stringify({
      displayName,
      list: { template: "genericList" }
    })
  });
  return data.id as string;
}

async function createColumn(siteId: string, listId: string, column: any) {
  await graphFetch(`/sites/${siteId}/lists/${listId}/columns`, {
    method: "POST",
    body: JSON.stringify(column)
  });
}

async function ensureList(siteId: string, name: string, columns: any[]) {
  const existing = await listExists(siteId, name);
  const listId = existing?.id ?? (await createList(siteId, name));
  if (!existing) {
    for (const column of columns) {
      await createColumn(siteId, listId, column);
    }
  }
  console.log(`${name}: ${existing ? "exists" : "created"}`);
}

async function run() {
  const siteId = await resolveSiteId();

  await ensureList(siteId, LISTS.requests, [
    { name: "Region", displayName: "Region", text: {}, required: true },
    { name: "Subsidiary", displayName: "Subsidiary", text: {}, required: true },
    { name: "Branch", displayName: "Branch", text: {}, required: true },
    { name: "Name", displayName: "Name", text: {}, required: true },
    { name: "Position", displayName: "Position", text: {}, required: true },
    { name: "RR", displayName: "R&R", text: {}, required: true },
    { name: "RequesterEmail", displayName: "Requester Email", text: {}, required: true },
    {
      name: "AirtableAccess",
      displayName: "Airtable Access",
      choice: { choices: ["Viewer", "Editor"], displayAs: "dropDownMenu" },
      required: true
    },
    {
      name: "Status",
      displayName: "Status",
      choice: {
        choices: ["Request Submitted", "Pending", "On Hold", "Completed"],
        displayAs: "dropDownMenu"
      },
      required: true
    },
    { name: "AdminComment", displayName: "Admin Comment", text: {} }
  ]);

  await ensureList(siteId, LISTS.activeAccess, [
    { name: "Region", displayName: "Region", text: {}, required: true },
    { name: "Subsidiary", displayName: "Subsidiary", text: {}, required: true },
    { name: "Branch", displayName: "Branch", text: {}, required: true },
    { name: "Name", displayName: "Name", text: {}, required: true },
    { name: "Email", displayName: "Email", text: {} },
    { name: "Position", displayName: "Position", text: {} },
    { name: "RR", displayName: "R&R", text: {} },
    {
      name: "AirtableAccess",
      displayName: "Airtable Access",
      choice: { choices: ["Viewer", "Editor"], displayAs: "dropDownMenu" },
      required: true
    },
    { name: "SourceRequestId", displayName: "Source Request ID", text: {} },
    { name: "ActivatedAt", displayName: "Activated At", dateTime: {} }
  ]);

  await ensureList(siteId, LISTS.reference, [
    { name: "Region", displayName: "Region", text: {}, required: true },
    { name: "Subsidiary", displayName: "Subsidiary", text: {}, required: true },
    { name: "Branch", displayName: "Branch", text: {}, required: true },
    { name: "IsActive", displayName: "Is Active", boolean: {}, required: true }
  ]);

  await ensureList(siteId, LISTS.admins, [
    { name: "Email", displayName: "Email", text: {}, required: true },
    {
      name: "Role",
      displayName: "Role",
      choice: { choices: ["Admin"], displayAs: "dropDownMenu" },
      required: true
    }
  ]);

  await ensureList(siteId, LISTS.settings, [
    {
      name: "CentralAdminEmail",
      displayName: "Central Admin Email",
      text: {},
      required: true
    },
    {
      name: "AdminNotifyRecipients",
      displayName: "Admin Notify Recipients",
      text: {}
    }
  ]);

  console.log("SharePoint list setup complete.");
}

run().catch((error) => {
  console.error("Setup failed", error);
  process.exit(1);
});
