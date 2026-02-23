const tenantId = process.env.AZURE_AD_TENANT_ID ?? "";
const clientId = process.env.AZURE_AD_CLIENT_ID ?? "";
const clientSecret = process.env.AZURE_AD_CLIENT_SECRET ?? "";

export async function getGraphToken() {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph token error: ${err}`);
  }

  const data = await res.json();
  return data.access_token as string;
}
