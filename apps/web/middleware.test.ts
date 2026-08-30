import { describe, it, expect } from "vitest";
import { config } from "./middleware";

/** The matcher is a regex embedded in a path pattern; Next compiles it the
 *  same way. */
const matches = (pathname: string) => new RegExp(`^${config.matcher[0]!}$`).test(pathname);

describe("middleware matcher", () => {
  it("lets the favicon through", () => {
    // The app-router icon convention serves the favicon from an ordinary
    // route. Without this exclusion the auth gate redirects it and the browser
    // gets HTML where it asked for an image — a silent failure: no error, no
    // console warning, just a blank tab icon, and worst on the sign-in page
    // where nobody is signed in by definition.
    expect(matches("/icon.svg")).toBe(false);
  });

  it("lets an install fetch the manifest and its icons", () => {
    // Same trap as the favicon, one layer out. A phone fetches the manifest
    // and its icons on "Add to home screen", and it may do so without the
    // session cookie; gated, they come back as the sign-in page's HTML and the
    // install silently gets no name and no icon.
    expect(matches("/manifest.webmanifest")).toBe(false);
    expect(matches("/icon-192.png")).toBe(false);
    expect(matches("/icon-512.png")).toBe(false);
    expect(matches("/apple-icon.png")).toBe(false);
  });

  it("still gates the app", () => {
    // The exclusions must stay narrow — the whole point of the middleware.
    expect(matches("/holdings")).toBe(true);
    expect(matches("/")).toBe(true);
    expect(matches("/asset/AAPL")).toBe(true);
  });

  it("leaves build output and the API alone", () => {
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/api/auth/session")).toBe(false);
  });
});
