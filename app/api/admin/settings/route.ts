import { NextResponse } from "next/server";
import { getAdminSettings, isAdminPasswordValid, upsertAdminSettings } from "@/lib/store";

export async function GET(request: Request) {
  const password = request.headers.get("x-admin-password") ?? "";
  const ok = await isAdminPasswordValid(password);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await getAdminSettings();
  return NextResponse.json({
    centralAdminEmail: settings.centralAdminEmail,
    adminNotifyRecipients: settings.adminNotifyRecipients
  });
}

export async function PUT(request: Request) {
  const password = request.headers.get("x-admin-password") ?? "";
  const ok = await isAdminPasswordValid(password);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.centralAdminEmail) {
    return NextResponse.json(
      { error: "Central Admin Email is required." },
      { status: 400 }
    );
  }

  const settings = await upsertAdminSettings({
    centralAdminEmail: body.centralAdminEmail,
    adminNotifyRecipients: body.adminNotifyRecipients ?? ""
  });

  return NextResponse.json(settings);
}
