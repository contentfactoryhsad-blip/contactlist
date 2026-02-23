import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getExpectedSiteToken, getSiteAuthCookieName, getSitePassword } from "./lib/siteAuth";

const PUBLIC_FILE = /\.(.*)$/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  if (PUBLIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/site-login" || pathname.startsWith("/api/site-login")) {
    return NextResponse.next();
  }

  if (!getSitePassword()) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(getSiteAuthCookieName())?.value;
  const expectedToken = await getExpectedSiteToken();
  const authorized = cookie && expectedToken && cookie === expectedToken;

  if (!authorized) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/site-login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next).*)"]
};
