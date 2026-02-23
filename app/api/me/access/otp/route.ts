import { NextResponse } from "next/server";
import { createAccessOtp, getActiveAccessRecord } from "@/lib/store";
import { sendAccessVerificationEmail } from "@/lib/email";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const recordId = String(body?.recordId ?? "").trim();
  if (!recordId) {
    return NextResponse.json(
      { error: "Record ID is required." },
      { status: 400 }
    );
  }

  const record = await getActiveAccessRecord(recordId);
  if (!record) {
    return NextResponse.json(
      { error: "Access record not found." },
      { status: 404 }
    );
  }

  const email = record.fields.Email ?? "";
  if (!email) {
    return NextResponse.json(
      { error: "Email is missing for this record." },
      { status: 400 }
    );
  }

  const { code, expiresAt } = await createAccessOtp(recordId, email);

  try {
    await sendAccessVerificationEmail({
      requesterEmail: email,
      name: record.fields.Name ?? "",
      branch: record.fields.Branch ?? "",
      access: record.fields.AirtableAccess ?? "",
      code,
      expiresInLabel: "2 minutes 30 seconds"
    });
  } catch (error) {
    console.warn("OTP email send failed", error);
  }

  return NextResponse.json({ success: true, expiresAt, ttlSeconds: 150 });
}
