"use client";

import { authClient } from "../lib/auth-client";

export function timeOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Time-of-day greeting with the user's first name. Renders without the name
 *  while the session loads, so there is no layout shift beyond the name text.
 *
 *  The text legitimately differs between server and client render: SSR has no
 *  session (no name) and uses the server clock, while the client may hydrate
 *  the session synchronously and sits in its own timezone. A single text node
 *  plus suppressHydrationWarning lets React patch the text instead of failing
 *  hydration for the whole tree. */
export function Greeting() {
  const { data: session } = authClient.useSession();
  const first = session?.user?.name?.trim().split(/\s+/)[0];
  const greeting = timeOfDay(new Date().getHours());
  return (
    <h1 className="text-title font-normal" suppressHydrationWarning>
      {`${greeting}${first ? `, ${first}` : ""}`}
    </h1>
  );
}
