import { NextResponse } from "next/server";
import {
  accessUpdateSchema,
  createRequestRecord,
  getAdminSettings,
  hasDuplicateAccessUpdate,
  hasDuplicateRequest,
  requestSchema
} from "@/lib/store";
import { isQuotaExceeded } from "@/lib/quota";
import { sendSubmissionEmails } from "@/lib/email";

export async function POST(request: Request) {
  const body = await request.json();
  const requestType =
    body?.requestType === "Access Update" ? "Access Update" : "New Access";

  const settings = await getAdminSettings();
  const contactEmail = settings.centralAdminEmail;

  if (requestType === "Access Update") {
    const parseResult = accessUpdateSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Please complete all required fields." },
        { status: 400 }
      );
    }

    const {
      region,
      subsidiary,
      branch,
      name,
      position,
      rr,
      currentAccess,
      requestedAccess,
      changeReason
    } = parseResult.data;
    const email = parseResult.data.email.trim().toLowerCase();

    const duplicate = await hasDuplicateAccessUpdate(
      email,
      branch,
      requestedAccess
    );
    if (duplicate) {
      return NextResponse.json(
        {
          error:
            "A pending access update already exists for this branch and request.",
          contactEmail
        },
        { status: 400 }
      );
    }

    if (
      ["Viewer", "Editor"].includes(requestedAccess) &&
      requestedAccess !== currentAccess
    ) {
      const quota = await isQuotaExceeded(branch, requestedAccess);
      if (quota.exceeded) {
        return NextResponse.json(
          {
            error: `Branch quota exceeded for ${requestedAccess}. Limit: ${quota.limit}. Please contact the admin team.`,
            contactEmail
          },
          { status: 400 }
        );
      }
    }

    const record = await createRequestRecord({
      RequestType: "Access Update",
      Region: region,
      Subsidiary: subsidiary,
      Branch: branch,
      Name: name,
      Position: position,
      RR: rr,
      RequesterEmail: email,
      AirtableAccess: requestedAccess,
      CurrentAccess: currentAccess,
      RequestedAccess: requestedAccess,
      ChangeReason: changeReason ?? "",
      Status: "Request Submitted"
    });

    try {
      await sendSubmissionEmails({
        requestId: record.id,
        requesterEmail: email,
        region,
        subsidiary,
        branch,
        name,
        position,
        rr,
        access: requestedAccess,
        status: "Request Submitted",
        requestType: "Access Update",
        currentAccess,
        requestedAccess,
        changeReason: changeReason ?? ""
      });
    } catch (error) {
      console.warn("Email send failed", error);
    }

    return NextResponse.json({ id: record.id }, { status: 201 });
  }

  const parseResult = requestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Please complete all required fields." },
      { status: 400 }
    );
  }

  const { region, subsidiary, branch, name, position, rr, access } =
    parseResult.data;
  const email = parseResult.data.email.trim().toLowerCase();

  const duplicate = await hasDuplicateRequest(email, branch, access);
  if (duplicate) {
    return NextResponse.json(
      {
        error:
          "A duplicate request already exists for this branch and access type.",
        contactEmail
      },
      { status: 400 }
    );
  }

  const quota = await isQuotaExceeded(branch, access);
  if (quota.exceeded) {
    return NextResponse.json(
      {
        error: `Branch quota exceeded for ${access}. Limit: ${quota.limit}. Please contact the admin team.`,
        contactEmail
      },
      { status: 400 }
    );
  }

  const record = await createRequestRecord({
    RequestType: "New Access",
    Region: region,
    Subsidiary: subsidiary,
    Branch: branch,
    Name: name,
    Position: position,
    RR: rr,
    RequesterEmail: email,
    AirtableAccess: access,
    RequestedAccess: access,
    Status: "Request Submitted"
  });

  try {
    await sendSubmissionEmails({
      requestId: record.id,
      requesterEmail: email,
      region,
      subsidiary,
      branch,
      name,
      position,
      rr,
      access,
      status: "Request Submitted",
      requestType: "New Access",
      requestedAccess: access
    });
  } catch (error) {
    console.warn("Email send failed", error);
  }

  return NextResponse.json({ id: record.id }, { status: 201 });
}
