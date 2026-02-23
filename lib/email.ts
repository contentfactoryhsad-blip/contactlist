import nodemailer from "nodemailer";
import { getAdminSettings } from "@/lib/store";

type EmailRow = { label: string; value: string };

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ?? "https://lgecreativehub.vercel.app";
const LOGO_URL = `${PUBLIC_BASE_URL}/email-logo.png`;

function getSmtpConfig() {
  const host = process.env.SMTP_HOST ?? "";
  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure = (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";

  if (!host || !user || !pass) {
    throw new Error("SMTP configuration is incomplete.");
  }

  return { host, port, secure, auth: { user, pass } };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRows(rows: EmailRow[]) {
  return rows
    .map((row) => {
      const label = escapeHtml(row.label);
      const value = escapeHtml(row.value || "-");
      return `<tr>
  <td style="padding:10px 0; color:#716F6A; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; border-bottom:1px solid #E6E1D6; width:180px;">${label}</td>
  <td style="padding:10px 0; color:#262626; font-weight:600; border-bottom:1px solid #E6E1D6;">${value}</td>
</tr>`;
    })
    .join("");
}

function renderEmailHtml(params: {
  title: string;
  intro: string;
  rows: EmailRow[];
  adminContact: string;
  highlightLabel?: string;
  highlightValue?: string;
}) {
  const rowsHtml = renderRows(params.rows);
  const highlight = params.highlightLabel
    ? `<div style="margin-top:16px; padding:14px; background:#F6F5EB; border:1px solid #E6E1D6; border-radius:12px;">
  <div style="font-weight:600; color:#A50034; margin-bottom:6px;">${escapeHtml(
    params.highlightLabel
  )}</div>
  <div style="color:#262626;">${escapeHtml(params.highlightValue || "-")}</div>
</div>`
    : "";

  return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#F6F5EB;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center" style="padding:24px;">
          <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px; width:100%; background:#ffffff; border-radius:18px; overflow:hidden; border:1px solid #E6E1D6;">
            <tr>
              <td style="height:6px; background:#A50034;"></td>
            </tr>
            <tr>
              <td style="padding:20px 24px 0 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                  <tr>
                    <td style="width:88px;">
                      <img src="${LOGO_URL}" alt="LG" width="73" height="40" style="display:block; width:73px; height:40px;" />
                    </td>
                    <td style="padding-left:12px;">
                      <div style="font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:#A50034;">Creative Hub</div>
                      <div style="font-size:16px; font-weight:600; color:#262626; margin-top:4px;">Airtable Access Request</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px 24px 24px;">
                <h2 style="margin:0 0 10px 0; font-size:22px; color:#262626;">${escapeHtml(
                  params.title
                )}</h2>
                <p style="margin:0 0 18px 0; color:#4A4946; line-height:1.6;">${escapeHtml(
                  params.intro
                )}</p>
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
                  ${rowsHtml}
                </table>
                ${highlight}
                <div style="margin-top:16px; padding:14px; background:#F6F5EB; border-radius:12px;">
                  <div style="font-weight:600; color:#A50034; margin-bottom:6px;">Admin Contact</div>
                  <div style="color:#262626;">${escapeHtml(params.adminContact)}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px; background:#F6F5EB; color:#4A4946; font-size:12px;">
                You are receiving this update from Creative Hub.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderEmailText(params: {
  intro: string;
  rows: EmailRow[];
  adminContact: string;
  highlightLabel?: string;
  highlightValue?: string;
}) {
  const bodyLines = params.rows.map((row) => `${row.label}: ${row.value || "-"}`);
  const highlight = params.highlightLabel
    ? `\n${params.highlightLabel}: ${params.highlightValue || "-"}`
    : "";
  return `${params.intro}\n\n${bodyLines.join("\n")}${highlight}\n\nAdmin Contact: ${params.adminContact}`;
}

export async function sendAccessVerificationEmail(payload: {
  requesterEmail: string;
  name: string;
  branch: string;
  access: string;
  code: string;
  expiresInLabel: string;
}) {
  const settings = await getAdminSettings();
  const smtpFrom = process.env.SMTP_FROM ?? "";
  const centralAdminEmail = settings.centralAdminEmail;
  const from = smtpFrom || centralAdminEmail;
  if (!from) {
    throw new Error("Central Admin Email or SMTP_FROM is not configured.");
  }

  const transporter = nodemailer.createTransport(getSmtpConfig());
  const adminContact = centralAdminEmail || from;
  const rows: EmailRow[] = [
    { label: "Name", value: payload.name },
    { label: "Branch", value: payload.branch },
    { label: "Current Access", value: payload.access }
  ].filter((row) => row.value);

  const subject = "Creative Hub | Verification Code";
  const intro = `Use the verification code below to update your access. This code expires in ${payload.expiresInLabel}.`;
  const requesterText = renderEmailText({
    intro,
    rows,
    adminContact,
    highlightLabel: "Verification Code",
    highlightValue: payload.code
  });
  const requesterHtml = renderEmailHtml({
    title: "Verify Your Access Update",
    intro,
    rows,
    adminContact,
    highlightLabel: "Verification Code",
    highlightValue: payload.code
  });

  await transporter.sendMail({
    from,
    to: payload.requesterEmail,
    subject,
    text: requesterText,
    html: requesterHtml
  });
}

export async function sendSubmissionEmails(payload: {
  requestId: string;
  requesterEmail: string;
  region: string;
  subsidiary: string;
  branch: string;
  name: string;
  position: string;
  rr: string;
  access: string;
  status: string;
  requestType?: string;
  currentAccess?: string;
  requestedAccess?: string;
  changeReason?: string;
}) {
  const settings = await getAdminSettings();
  const smtpFrom = process.env.SMTP_FROM ?? "";
  const centralAdminEmail = settings.centralAdminEmail;
  const from = smtpFrom || centralAdminEmail;
  if (!from) {
    throw new Error("Central Admin Email or SMTP_FROM is not configured.");
  }

  const recipients = settings.adminNotifyRecipients
    .split(/\r?\n/)
    .map((email) => email.trim())
    .filter(Boolean);

  const transporter = nodemailer.createTransport(getSmtpConfig());

  const adminContact = centralAdminEmail || from;
  const rows: EmailRow[] = [
    { label: "Request Type", value: payload.requestType ?? "New Access" },
    { label: "Region", value: payload.region },
    { label: "Subsidiary", value: payload.subsidiary },
    { label: "Branch", value: payload.branch },
    { label: "Name", value: payload.name },
    { label: "Position", value: payload.position },
    { label: "R&R", value: payload.rr },
    { label: "Requester Email", value: payload.requesterEmail },
    { label: "Airtable Access", value: payload.access },
    { label: "Current Access", value: payload.currentAccess ?? "" },
    { label: "Requested Access", value: payload.requestedAccess ?? "" },
    { label: "Change Reason", value: payload.changeReason ?? "" },
    { label: "Status", value: payload.status }
  ].filter((row) => row.value);
  const subject =
    payload.requestType === "Access Update"
      ? "Creative Hub | Access Update Received"
      : "Creative Hub | Request Received";
  const requesterText = renderEmailText({
    intro: "Your access request has been received.",
    rows,
    adminContact
  });
  const requesterHtml = renderEmailHtml({
    title:
      payload.requestType === "Access Update"
        ? "Thanks — Update Request Received"
        : "Thanks — Request Received",
    intro: "Your access request is in. We will notify you as it moves through review.",
    rows,
    adminContact
  });
  const adminText = renderEmailText({
    intro:
      payload.requestType === "Access Update"
        ? "New access update request received."
        : "New access request received.",
    rows,
    adminContact
  });
  const adminHtml = renderEmailHtml({
    title:
      payload.requestType === "Access Update"
        ? "New Update Request Received"
        : "New Request Received",
    intro:
      payload.requestType === "Access Update"
        ? "A new access update request has been submitted."
        : "A new access request has been submitted.",
    rows,
    adminContact
  });
  const replyTo = centralAdminEmail && centralAdminEmail !== from ? centralAdminEmail : undefined;

  await transporter.sendMail({
    from,
    replyTo,
    to: payload.requesterEmail,
    subject,
    text: requesterText,
    html: requesterHtml
  });

  if (recipients.length > 0) {
    await transporter.sendMail({
      from,
      replyTo,
      to: recipients,
      subject,
      text: adminText,
      html: adminHtml
    });
  }
}

export async function sendDeletionEmails(payload: {
  requesterEmail: string;
  requestId: string;
  region: string;
  subsidiary: string;
  branch: string;
  name: string;
  position: string;
  rr: string;
  access: string;
  status: string;
  reason: string;
  requestType?: string;
  currentAccess?: string;
  requestedAccess?: string;
  changeReason?: string;
}) {
  const settings = await getAdminSettings();
  const smtpFrom = process.env.SMTP_FROM ?? "";
  const centralAdminEmail = settings.centralAdminEmail;
  const from = smtpFrom || centralAdminEmail;
  if (!from) {
    throw new Error("Central Admin Email or SMTP_FROM is not configured.");
  }

  const recipients = settings.adminNotifyRecipients
    .split(/\r?\n/)
    .map((email) => email.trim())
    .filter(Boolean);

  const transporter = nodemailer.createTransport(getSmtpConfig());

  const adminContact = centralAdminEmail || from;
  const rows: EmailRow[] = [
    { label: "Request Type", value: payload.requestType ?? "New Access" },
    { label: "Region", value: payload.region },
    { label: "Subsidiary", value: payload.subsidiary },
    { label: "Branch", value: payload.branch },
    { label: "Name", value: payload.name },
    { label: "Position", value: payload.position },
    { label: "R&R", value: payload.rr },
    { label: "Requester Email", value: payload.requesterEmail },
    { label: "Airtable Access", value: payload.access },
    { label: "Current Access", value: payload.currentAccess ?? "" },
    { label: "Requested Access", value: payload.requestedAccess ?? "" },
    { label: "Change Reason", value: payload.changeReason ?? "" },
    { label: "Status", value: payload.status }
  ].filter((row) => row.value);
  const subject = "Creative Hub | Request Closed";
  const requesterText = renderEmailText({
    intro: "Your access request was deleted.",
    rows,
    adminContact,
    highlightLabel: "Delete Reason",
    highlightValue: payload.reason
  });
  const requesterHtml = renderEmailHtml({
    title: "Request Closed",
    intro: "Your access request was closed by the admin team.",
    rows,
    adminContact,
    highlightLabel: "Delete Reason",
    highlightValue: payload.reason
  });
  const adminText = renderEmailText({
    intro: "An access request was deleted.",
    rows,
    adminContact,
    highlightLabel: "Delete Reason",
    highlightValue: payload.reason
  });
  const adminHtml = renderEmailHtml({
    title: "Request Deleted",
    intro: "An access request was deleted.",
    rows,
    adminContact,
    highlightLabel: "Delete Reason",
    highlightValue: payload.reason
  });
  const replyTo =
    centralAdminEmail && centralAdminEmail !== from ? centralAdminEmail : undefined;

  if (payload.requesterEmail) {
    await transporter.sendMail({
      from,
      replyTo,
      to: payload.requesterEmail,
      subject,
      text: requesterText,
      html: requesterHtml
    });
  }

  if (recipients.length > 0) {
    await transporter.sendMail({
      from,
      replyTo,
      to: recipients,
      subject,
      text: adminText,
      html: adminHtml
    });
  }
}

export async function sendCompletionEmails(payload: {
  requesterEmail: string;
  requestId: string;
  region: string;
  subsidiary: string;
  branch: string;
  name: string;
  position: string;
  rr: string;
  access: string;
  status: string;
  adminComment: string;
  requestType?: string;
  currentAccess?: string;
  requestedAccess?: string;
  changeReason?: string;
}) {
  const settings = await getAdminSettings();
  const smtpFrom = process.env.SMTP_FROM ?? "";
  const centralAdminEmail = settings.centralAdminEmail;
  const from = smtpFrom || centralAdminEmail;
  if (!from) {
    throw new Error("Central Admin Email or SMTP_FROM is not configured.");
  }

  const recipients = settings.adminNotifyRecipients
    .split(/\r?\n/)
    .map((email) => email.trim())
    .filter(Boolean);

  const transporter = nodemailer.createTransport(getSmtpConfig());

  const adminContact = centralAdminEmail || from;
  const rows: EmailRow[] = [
    { label: "Request Type", value: payload.requestType ?? "New Access" },
    { label: "Region", value: payload.region },
    { label: "Subsidiary", value: payload.subsidiary },
    { label: "Branch", value: payload.branch },
    { label: "Name", value: payload.name },
    { label: "Position", value: payload.position },
    { label: "R&R", value: payload.rr },
    { label: "Requester Email", value: payload.requesterEmail },
    { label: "Airtable Access", value: payload.access },
    { label: "Current Access", value: payload.currentAccess ?? "" },
    { label: "Requested Access", value: payload.requestedAccess ?? "" },
    { label: "Change Reason", value: payload.changeReason ?? "" },
    { label: "Status", value: payload.status }
  ].filter((row) => row.value);
  const subject = "Creative Hub | Access Ready";
  const requesterText = renderEmailText({
    intro: "Your access request has been completed.",
    rows,
    adminContact,
    highlightLabel: "Admin Comment",
    highlightValue: payload.adminComment || "-"
  });
  const requesterHtml = renderEmailHtml({
    title: "Access Ready",
    intro: "Your access request has been completed.",
    rows,
    adminContact,
    highlightLabel: "Admin Comment",
    highlightValue: payload.adminComment || "-"
  });
  const adminText = renderEmailText({
    intro: "Access request completed.",
    rows,
    adminContact,
    highlightLabel: "Admin Comment",
    highlightValue: payload.adminComment || "-"
  });
  const adminHtml = renderEmailHtml({
    title: "Request Completed",
    intro: "Access request completed.",
    rows,
    adminContact,
    highlightLabel: "Admin Comment",
    highlightValue: payload.adminComment || "-"
  });
  const replyTo =
    centralAdminEmail && centralAdminEmail !== from ? centralAdminEmail : undefined;

  if (payload.requesterEmail) {
    await transporter.sendMail({
      from,
      replyTo,
      to: payload.requesterEmail,
      subject,
      text: requesterText,
      html: requesterHtml
    });
  }

  if (recipients.length > 0) {
    await transporter.sendMail({
      from,
      replyTo,
      to: recipients,
      subject,
      text: adminText,
      html: adminHtml
    });
  }
}

export async function sendStatusUpdateEmail(payload: {
  requesterEmail: string;
  region: string;
  subsidiary: string;
  branch: string;
  name: string;
  position: string;
  rr: string;
  access: string;
  status: string;
  adminComment: string;
  requestType?: string;
  currentAccess?: string;
  requestedAccess?: string;
  changeReason?: string;
}) {
  const settings = await getAdminSettings();
  const smtpFrom = process.env.SMTP_FROM ?? "";
  const centralAdminEmail = settings.centralAdminEmail;
  const from = smtpFrom || centralAdminEmail;
  if (!from) {
    throw new Error("Central Admin Email or SMTP_FROM is not configured.");
  }

  const transporter = nodemailer.createTransport(getSmtpConfig());
  const subject = "Creative Hub | Status Update";
  const adminContact = centralAdminEmail || from;
  const rows: EmailRow[] = [
    { label: "Request Type", value: payload.requestType ?? "New Access" },
    { label: "Region", value: payload.region },
    { label: "Subsidiary", value: payload.subsidiary },
    { label: "Branch", value: payload.branch },
    { label: "Name", value: payload.name },
    { label: "Position", value: payload.position },
    { label: "R&R", value: payload.rr },
    { label: "Requester Email", value: payload.requesterEmail },
    { label: "Airtable Access", value: payload.access },
    { label: "Current Access", value: payload.currentAccess ?? "" },
    { label: "Requested Access", value: payload.requestedAccess ?? "" },
    { label: "Change Reason", value: payload.changeReason ?? "" },
    { label: "Status", value: payload.status }
  ].filter((row) => row.value);
  const requesterText = renderEmailText({
    intro: "Your access request has an update.",
    rows,
    adminContact,
    highlightLabel: "Admin Comment",
    highlightValue: payload.adminComment || "-"
  });
  const requesterHtml = renderEmailHtml({
    title: "Status Update",
    intro: "There is a new update on your access request.",
    rows,
    adminContact,
    highlightLabel: "Admin Comment",
    highlightValue: payload.adminComment || "-"
  });
  const replyTo =
    centralAdminEmail && centralAdminEmail !== from ? centralAdminEmail : undefined;

  await transporter.sendMail({
    from,
    replyTo,
    to: payload.requesterEmail,
    subject,
    text: requesterText,
    html: requesterHtml
  });
}
