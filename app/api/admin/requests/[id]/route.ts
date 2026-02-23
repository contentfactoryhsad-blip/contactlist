import { NextResponse } from "next/server";
import {
  addActiveAccess,
  deleteRequestRecord,
  hasActiveAccess,
  isAdminPasswordValid,
  logDeletedRequest,
  updateRequestRecord
} from "@/lib/store";
import { isQuotaExceeded } from "@/lib/quota";
import { sendCompletionEmails, sendDeletionEmails } from "@/lib/email";

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

  const updated = await updateRequestRecord(recordId, body);

  const fields = updated.fields as Record<string, string>;
  const previousStatus = (updated as { previous?: Record<string, string> }).previous
    ?.Status;
  const status = fields.Status ?? body.Status;
  const branch = fields.Branch ?? body.Branch;
  const access = fields.AirtableAccess ?? body.AirtableAccess;
  const requesterEmail = fields.RequesterEmail ?? body.RequesterEmail;
  const requestId = fields.RequestId ?? recordId;
  const requestType = fields.RequestType ?? body.RequestType ?? "New Access";

  if (
    status === "Completed" &&
    branch &&
    access &&
    requesterEmail &&
    requestType !== "Access Update"
  ) {
    const alreadyActive = await hasActiveAccess(requesterEmail, branch, access);
    if (!alreadyActive) {
      await addActiveAccess({
        Region: fields.Region ?? "",
        Subsidiary: fields.Subsidiary ?? "",
        Branch: branch,
        Name: fields.Name ?? "",
        Position: fields.Position ?? "",
        RR: fields.RR ?? "",
        Email: requesterEmail,
        AirtableAccess: access,
        SourceRequestId: recordId,
        ActivatedAt: new Date().toISOString()
      });
    }

    if (previousStatus !== "Completed") {
      try {
        await sendCompletionEmails({
          requestId,
          requesterEmail,
          region: fields.Region ?? "",
          subsidiary: fields.Subsidiary ?? "",
          branch,
          name: fields.Name ?? "",
          position: fields.Position ?? "",
          rr: fields.RR ?? "",
          access,
          status,
          adminComment: fields.AdminComment ?? "",
          requestType: fields.RequestType ?? "New Access",
          currentAccess: fields.CurrentAccess ?? "",
          requestedAccess: fields.RequestedAccess ?? "",
          changeReason: fields.ChangeReason ?? ""
        });
      } catch (error) {
        console.warn("Completion email send failed", error);
      }
    }
  }

  let quotaExceeded = false;
  if (branch && access) {
    const quota = await isQuotaExceeded(branch, access);
    quotaExceeded = quota.exceeded;
  }

  return NextResponse.json({ record: updated, quotaExceeded });
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

  const recordId = params.id;
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

  const deleted = await deleteRequestRecord(recordId);
  const fields = (deleted.fields ?? {}) as Record<string, string>;
  const requestId = fields.RequestId ?? deleted.id;
  try {
    await logDeletedRequest(fields, reason, requestId);
  } catch (error) {
    console.warn("Failed to log deleted request", error);
  }
  const requesterEmail = fields.RequesterEmail ?? "";
  const branch = fields.Branch ?? "";
  const access = fields.AirtableAccess ?? "";
  const status = fields.Status ?? "";
  try {
    await sendDeletionEmails({
      requesterEmail,
      requestId,
      region: fields.Region ?? "",
      subsidiary: fields.Subsidiary ?? "",
      branch,
      name: fields.Name ?? "",
      position: fields.Position ?? "",
      rr: fields.RR ?? "",
      access,
      status,
      reason,
      requestType: fields.RequestType ?? "New Access",
      currentAccess: fields.CurrentAccess ?? "",
      requestedAccess: fields.RequestedAccess ?? "",
      changeReason: fields.ChangeReason ?? ""
    });
  } catch (error) {
    console.warn("Deletion email send failed", error);
  }

  return NextResponse.json({ success: true });
}
