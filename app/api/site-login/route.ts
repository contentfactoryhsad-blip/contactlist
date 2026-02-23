import { NextResponse } from "next/server";
import {
  createSiteToken,
  getSiteAuthCookieName,
  getSiteAuthMaxAgeSeconds,
  getSitePassword,
  isSitePasswordValid
} from "@/lib/siteAuth";
import { logLoginAttempt } from "@/lib/store";

function getClientIp(request: Request) {
  const header = request.headers.get("x-forwarded-for");
  if (header) {
    return header.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "";
}

export async function POST(request: Request) {
  const { password } = (await request.json()) as { password?: string };
  const url = new URL(request.url);
  const meta = {
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? "",
    path: url.pathname,
    referer: request.headers.get("referer") ?? "",
    acceptLanguage: request.headers.get("accept-language") ?? ""
  };

  if (!getSitePassword()) {
    return NextResponse.json(
      { error: "Site password is not configured." },
      { status: 500 }
    );
  }

  if (!password || !(await isSitePasswordValid(password))) {
    try {
      await logLoginAttempt({ result: "failed", ...meta });
    } catch (error) {
      console.warn("Login audit failed", error);
    }
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401 }
    );
  }

  const token = await createSiteToken();
  try {
    await logLoginAttempt({ result: "success", ...meta });
  } catch (error) {
    console.warn("Login audit failed", error);
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(getSiteAuthCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: getSiteAuthMaxAgeSeconds(),
    path: "/",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}
