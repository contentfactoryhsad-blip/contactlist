import { getAdminSettings } from "@/lib/store";
import { getGraphToken } from "@/lib/msgraph";

export async function sendSubmissionEmails(payload: {
  requesterEmail: string;
  requestId: string;
  branch: string;
  access: string;
  status: string;
}) {
  const settings = await getAdminSettings();
  const sender = settings.centralAdminEmail;
  if (!sender) {
    throw new Error("Central Admin Email is not configured.");
  }

  const recipients = settings.adminNotifyRecipients
    .split(/\r?\n/)
    .map((email) => email.trim())
    .filter(Boolean);

  const token = await getGraphToken();

  const subject = "Airtable Access Request Received";
  const body = `Your request has been received.\n\nRequest ID: ${payload.requestId}\nBranch: ${payload.branch}\nAccess: ${payload.access}\nStatus: ${payload.status}`;

  const sendMail = async (toEmails: string[]) => {
    if (toEmails.length === 0) return;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: {
            subject,
            body: {
              contentType: "Text",
              content: body
            },
            toRecipients: toEmails.map((email) => ({
              emailAddress: { address: email }
            }))
          },
          saveToSentItems: "true"
        })
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph sendMail error: ${err}`);
    }
  };

  await sendMail([payload.requesterEmail]);
  if (recipients.length > 0) {
    await sendMail(recipients);
  }
}
