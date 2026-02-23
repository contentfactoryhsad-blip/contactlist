import { NextResponse } from "next/server";
import { isAdminPasswordValid, listActiveAccess } from "@/lib/store";

export async function GET(request: Request) {
  const password = request.headers.get("x-admin-password") ?? "";
  const ok = await isAdminPasswordValid(password);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const records = await listActiveAccess();
  return NextResponse.json({ records });
}
