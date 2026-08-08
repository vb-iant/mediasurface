import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

// Only /admin/* is gated. The homepage and /blog are intentionally public
// and never touched by this middleware.
export const config = {
  matcher: ["/admin/:path*"],
};

export async function proxy(request: NextRequest) {
  // /admin/login is itself under /admin/*, so it matches above — carve it
  // out explicitly rather than gating it too.
  if (request.nextUrl.pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = await verifySessionToken(token);

  if (!authenticated) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
