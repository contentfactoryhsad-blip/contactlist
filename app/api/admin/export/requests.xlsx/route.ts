import { NextResponse } from "next/server";
import {
  isAdminPasswordValid,
  listAllRequests,
  mapRequestForExport
} from "@/lib/store";
import { buildWorkbookFromRecords } from "@/lib/export";

export async function GET(request: Request) {
  const password = request.headers.get("x-admin-password") ?? "";
  const ok = await isAdminPasswordValid(password);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const records = await listAllRequests();
  const rows = records.map((record) => ({
    fields: mapRequestForExport(record.fields)
  }));
  const buffer = buildWorkbookFromRecords("Requests", rows);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=Requests.xlsx"
    }
  });
}
