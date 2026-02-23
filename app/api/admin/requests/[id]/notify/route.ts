import { NextResponse } from "next/server";
import { getRequestRecord, isAdminPasswordValid } from "@/lib/store";
import { sendStatusUpdateEmail } from "@/lib/email";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const password = request.headers.get("x-admin-password") ?? "";
  const ok = await isAdminPasswordValid(password);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const record = await getRequestRecord(params.id);
  if (!record) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const fields = record.fields as Record<string, string>;
  const requesterEmail = fields.RequesterEmail ?? "";
  if (!requesterEmail) {
    return NextResponse.json(
      { error: "Requester email is missing." },
      { status: 400 }
    );
  }

  try {
    await sendStatusUpdateEmail({
      requesterEmail,
      region: fields.Region ?? "",
      subsidiary: fields.Subsidiary ?? "",
      branch: fields.Branch ?? "",
      name: fields.Name ?? "",
      position: fields.Position ?? "",
      rr: fields.RR ?? "",
      access: fields.AirtableAccess ?? "",
      status: fields.Status ?? "",
      adminComment: fields.AdminComment ?? "",
      requestType: fields.RequestType ?? "New Access",
      currentAccess: fields.CurrentAccess ?? "",
      requestedAccess: fields.RequestedAccess ?? "",
      changeReason: fields.ChangeReason ?? ""
    });
  } catch (error) {
    console.warn("Status update email failed", error);
    return NextResponse.json(
      { error: "Failed to send notification email." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
