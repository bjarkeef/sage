import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
};

/** Read BETTER_AUTH_SECRET out of a shipped .env.example, so these tests fail
 *  if a placeholder is reworded without updating the guard in env.ts. */
function exampleSecret(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith("BETTER_AUTH_SECRET="));
  if (!line) throw new Error(`no BETTER_AUTH_SECRET in ${relativePath}`);
  return line.slice("BETTER_AUTH_SECRET=".length).trim();
}

const SHIPPED_EXAMPLE_SECRETS = [
  exampleSecret("../.env.example"),
  exampleSecret("../../../.env.example"),
];

describe("parseEnv", () => {
  it("parses a valid environment with yahoo (default)", () => {
    const env = parseEnv({ ...base, PORT: "4000", NODE_ENV: "test" });
    expect(env).toMatchObject({
      DATABASE_URL: "postgres://x",
      MARKET_DATA_PROVIDER: "yahoo",
      PORT: 4000,
      NODE_ENV: "test",
    });
  });

  it("parses a valid environment with eodhd", () => {
    const env = parseEnv({
      ...base,
      MARKET_DATA_PROVIDER: "eodhd",
      EODHD_API_TOKEN: "test-token",
    });
    expect(env.MARKET_DATA_PROVIDER).toBe("eodhd");
    expect(env.EODHD_API_TOKEN).toBe("test-token");
  });

  it("applies defaults for PORT, NODE_ENV, MARKET_DATA_PROVIDER, and ENRICHMENT_PROVIDER", () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe("development");
    expect(env.MARKET_DATA_PROVIDER).toBe("yahoo");
    // `yahoo`, not `none`: with no enrichment provider, sector, country and
    // region are `Unknown` for every holding, so a stock install shipped three
    // of Diversification's five dimensions empty. It needs no key and talks to
    // the same host prices already come from.
    expect(env.ENRICHMENT_PROVIDER).toBe("yahoo");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it("throws when EODHD_API_TOKEN is missing and provider is eodhd", () => {
    expect(() => parseEnv({ ...base, MARKET_DATA_PROVIDER: "eodhd" })).toThrow(/EODHD_API_TOKEN/);
  });

  it("does not require EODHD_API_TOKEN when provider is yahoo", () => {
    const env = parseEnv({ ...base, MARKET_DATA_PROVIDER: "yahoo" });
    expect(env.EODHD_API_TOKEN).toBeUndefined();
  });

  it("requires BETTER_AUTH_SECRET", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://x" })).toThrow("BETTER_AUTH_SECRET");
  });

  it("defaults AUTH_BASE_URL to http://localhost:3001", () => {
    const env = parseEnv(base);
    expect(env.AUTH_BASE_URL).toBe("http://localhost:3001");
  });

  it("defaults WEB_ORIGIN to http://localhost:3000", () => {
    const env = parseEnv(base);
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  describe("the shipped example secret", () => {
    it("still boots outside production, so the quick start stays one command", () => {
      for (const secret of SHIPPED_EXAMPLE_SECRETS) {
        expect(() =>
          parseEnv({ ...base, BETTER_AUTH_SECRET: secret, NODE_ENV: "development" }),
        ).not.toThrow();
      }
    });

    it("is refused in production, where it would let anyone forge a session", () => {
      // Reads the real .env.example files: if someone rewords a placeholder
      // without updating PLACEHOLDER_SECRETS, this fails rather than quietly
      // leaving self-hosters unguarded.
      for (const secret of SHIPPED_EXAMPLE_SECRETS) {
        expect(() =>
          parseEnv({ ...base, BETTER_AUTH_SECRET: secret, NODE_ENV: "production" }),
        ).toThrow(/BETTER_AUTH_SECRET/);
      }
    });

    it("accepts a real secret in production", () => {
      expect(() =>
        parseEnv({
          ...base,
          BETTER_AUTH_SECRET: "f3a9c2e1b7d40658af219c3e8b5d7042f3a9c2e1b7d40658",
          NODE_ENV: "production",
        }),
      ).not.toThrow();
    });
  });

  // A provider name that is no longer supported must be rejected, not silently
  // defaulted to yahoo: an operator who set MARKET_DATA_PROVIDER=alphavantage
  // deserves a startup error telling them the option is gone, rather than an
  // app that quietly serves different data than they configured.
  it("rejects a provider name that is not supported", () => {
    expect(() => parseEnv({ ...base, MARKET_DATA_PROVIDER: "alphavantage" })).toThrow(
      /MARKET_DATA_PROVIDER/,
    );
    expect(() => parseEnv({ ...base, ENRICHMENT_PROVIDER: "alphavantage" })).toThrow(
      /ENRICHMENT_PROVIDER/,
    );
  });

  it("defaults ALLOW_SIGNUP to true", () => {
    expect(parseEnv(base).ALLOW_SIGNUP).toBe(true);
  });

  it("parses ALLOW_SIGNUP=false", () => {
    expect(parseEnv({ ...base, ALLOW_SIGNUP: "false" }).ALLOW_SIGNUP).toBe(false);
  });

  it("parses a valid environment with twelvedata", () => {
    const env = parseEnv({
      ...base,
      MARKET_DATA_PROVIDER: "twelvedata",
      TWELVEDATA_API_KEY: "test-key",
    });
    expect(env.MARKET_DATA_PROVIDER).toBe("twelvedata");
    expect(env.TWELVEDATA_API_KEY).toBe("test-key");
    // The free plan's allowance, so an unset value can never over-spend a key.
    expect(env.TWELVEDATA_CREDITS_PER_MINUTE).toBe(8);
  });

  it("throws when TWELVEDATA_API_KEY is missing and provider is twelvedata", () => {
    expect(() => parseEnv({ ...base, MARKET_DATA_PROVIDER: "twelvedata" })).toThrow(
      /TWELVEDATA_API_KEY/,
    );
  });

  it("reads TWELVEDATA_CREDITS_PER_MINUTE and refuses zero or negative", () => {
    expect(
      parseEnv({ ...base, TWELVEDATA_CREDITS_PER_MINUTE: "610" }).TWELVEDATA_CREDITS_PER_MINUTE,
    ).toBe(610);
    expect(() => parseEnv({ ...base, TWELVEDATA_CREDITS_PER_MINUTE: "0" })).toThrow();
    expect(() => parseEnv({ ...base, TWELVEDATA_CREDITS_PER_MINUTE: "-5" })).toThrow();
  });
});
