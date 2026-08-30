import { NextRequest, NextResponse } from "next/server";

const publicPaths = ["/sign-in", "/sign-up"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // `icon.svg` is load-bearing, not tidiness: the app-router icon convention
  // serves the favicon from a normal route, so without the exclusion the auth
  // gate redirects it to /sign-in and the browser gets HTML where it asked for
  // an image — no icon, on the sign-in page most of all, where nobody is
  // signed in by definition.
  //
  // The manifest and its PNGs are the same trap one layer out: a phone fetches
  // them on "Add to home screen" and may do so without the session cookie, so
  // gated they yield HTML and the install ends up unnamed and iconless.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|icon-192.png|icon-512.png|apple-icon.png|api).*)",
  ],
};
