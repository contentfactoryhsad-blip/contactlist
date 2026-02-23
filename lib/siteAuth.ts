const COOKIE_NAME = "site_auth";
const ONE_DAY_SECONDS = 60 * 60 * 24;

export function getSitePassword() {
  return process.env.SITE_PASSWORD || process.env.ADMIN_PASSWORD || "";
}

export function getSiteAuthCookieName() {
  return COOKIE_NAME;
}

export function getSiteAuthMaxAgeSeconds() {
  return ONE_DAY_SECONDS;
}

async function sha256Hex(value: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getExpectedSiteToken() {
  const password = getSitePassword();
  if (!password) return "";
  return sha256Hex(password);
}

export async function isSitePasswordValid(input: string) {
  const expected = getSitePassword();
  if (!expected) return false;
  return input === expected;
}

export async function createSiteToken() {
  const password = getSitePassword();
  if (!password) return "";
  return sha256Hex(password);
}
