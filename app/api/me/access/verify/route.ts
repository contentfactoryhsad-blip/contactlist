import { NextResponse } from "next/server";
import {
  getActiveAccessRecord,
  updateActiveAccessRecord,
  verifyAccessOtp
} from "@/lib/store";
import { isQuotaExceeded } from "@/lib/quota";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const recordId = String(body?.recordId ?? "").trim();
  const code = String(body?.code ?? "").trim();
  const position = String(body?.position ?? "").trim();
  const rr = String(body?.rr ?? "").trim();
  const access = String(body?.access ?? "").trim();
  const allowedAccess = ["Viewer", "Editor", "Related mail recipient"];

  if (!recordId || !code || !position || !rr || !access) {
    return NextResponse.json(
      { error: "Please complete all required fields." },
      { status: 400 }
    );
  }
  if (!allowedAccess.includes(access)) {
    return NextResponse.json(
      { error: "Invalid access selection." },
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

  const otpCheck = await verifyAccessOtp(recordId, email, code);
  if (!otpCheck.ok) {
    if (otpCheck.reason === "expired") {
      return NextResponse.json(
        { error: "Verification code expired. Please resend a new code.", code: "expired" },
        { status: 400 }
      );
    }
    if (otpCheck.reason === "invalid") {
      return NextResponse.json(
        {
          error: "Verification code is incorrect.",
          code: "invalid",
          attemptsLeft: otpCheck.attemptsLeft
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Verification code not found. Please resend a new code.", code: "missing" },
      { status: 400 }
    );
  }

  const currentAccess = record.fields.AirtableAccess ?? "";
  if (["Viewer", "Editor"].includes(access) && access !== currentAccess) {
    const quota = await isQuotaExceeded(record.fields.Branch ?? "", access);
    if (quota.exceeded) {
      return NextResponse.json(
        {
          error: `Branch quota exceeded for ${access}. Limit: ${quota.limit}. Please contact the admin team.`
        },
        { status: 400 }
      );
    }
  }

  const updated = await updateActiveAccessRecord(recordId, {
    Position: position,
    RR: rr,
    AirtableAccess: access
  });

  return NextResponse.json({ success: true, record: updated });
}
