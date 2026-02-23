import { NextResponse } from "next/server";
import {
  deleteActiveAccessRecord,
  isAdminPasswordValid,
  logDeletedActiveAccess,
  updateActiveAccessRecord
} from "@/lib/store";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const password = request.headers.get("x-admin-password") ?? "";
  const ok = await isAdminPasswordValid(password);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const recordId = params.id;

  const updated = await updateActiveAccessRecord(recordId, body);
  return NextResponse.json({ record: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const password = request.headers.get("x-admin-password") ?? "";
  const ok = await isAdminPasswordValid(password);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let reason = "";
  try {
    const body = await request.json();
    reason = String(body?.reason ?? "").trim();
  } catch {
    reason = "";
  }

  if (!reason) {
    return NextResponse.json(
      { error: "Delete reason is required." },
      { status: 400 }
    );
  }

  const deleted = await deleteActiveAccessRecord(params.id);
  try {
    await logDeletedActiveAccess(deleted.fields ?? {}, reason);
  } catch (error) {
    console.warn("Failed to log deleted active access", error);
  }

  return NextResponse.json({ success: true });
}
