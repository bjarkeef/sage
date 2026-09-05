import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Reads the real docker-compose.yml, the same way env.test.ts reads the
 *  shipped .env.example: a guard is only worth having if it fails when someone
 *  edits the actual file. */
const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");

/** Everything under `services:` and before the next top-level key — without
 *  the bound, the trailing `volumes:` block's entries parse as services. */
function servicesBody(yaml: string): string {
  const after = yaml.split(/^services:\s*$/m)[1] ?? "";
  const end = after.search(/^\S/m);
  return end === -1 ? after : after.slice(0, end);
}

/** Top-level service names — two-space indented keys. */
function serviceNames(yaml: string): string[] {
  return [...servicesBody(yaml).matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]!);
}

/** The block of lines belonging to one service, up to the next service. */
function serviceBlock(yaml: string, name: string): string {
  const body = servicesBody(yaml);
  const start = body.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  if (start === -1) return "";
  const rest = body.slice(start).replace(/^ {2}\S.*\n/, "");
  const next = rest.search(/^ {2}\S/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("docker-compose", () => {
  it("declares the three services the self-host stack needs", () => {
    expect(serviceNames(compose).sort()).toEqual(["api", "db", "web"]);
  });

  // Sage is meant to be left running on a box the operator does not sit in
  // front of. Without a restart policy, a reboot or a crashed container leaves
  // it down until someone notices — and "someone notices" for a personal
  // portfolio tracker means the next time they wanted to look at it.
  it("restarts every service, so a reboot does not silently take Sage down", () => {
    for (const name of serviceNames(compose)) {
      expect(serviceBlock(compose, name), `service "${name}" has no restart policy`).toMatch(
        /^\s*restart:\s*unless-stopped$/m,
      );
    }
  });

  // `always` would restart a container the operator deliberately stopped.
  it("does not use a policy that overrides a deliberate stop", () => {
    expect(compose).not.toMatch(/^\s*restart:\s*always$/m);
  });

  // Next freezes NEXT_PUBLIC_* into the browser bundle at build time, so a
  // value supplied only as a runtime `environment:` entry never reaches the
  // client — it silently keeps whatever was inlined during the build. That is
  // how `NEXT_PUBLIC_SAGE_API_URL` shipped: compose set it at runtime, the
  // Dockerfile never declared it, and every install not on localhost loaded
  // the page and then failed every request against the baked-in localhost
  // fallback, sign-up included. Nothing failed loudly.
  //
  // Asserted against the variables the web app actually reads rather than a
  // hardcoded list, so the next one added is covered without editing this test.
  it("passes every NEXT_PUBLIC_* the web app reads as a build arg", () => {
    const used = new Set<string>();
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (/^(node_modules|\.next|dist|coverage)$/.test(entry.name)) continue;
        const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
        if (entry.isDirectory()) walk(child);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          for (const m of readFileSync(child, "utf8").matchAll(
            /process\.env\.(NEXT_PUBLIC_\w+)/g,
          )) {
            used.add(m[1]!);
          }
        }
      }
    };
    walk(new URL("../../../apps/web/", import.meta.url));

    // A guard that asserts nothing is worse than no guard: if the scan finds
    // nothing, the walk broke rather than the app being clean.
    expect(used.size).toBeGreaterThan(0);

    const dockerfile = readFileSync(
      new URL("../../../apps/web/Dockerfile", import.meta.url),
      "utf8",
    );
    const webArgs = serviceBlock(compose, "web");

    for (const name of [...used].sort()) {
      expect(
        dockerfile,
        `${name} is read by the browser but has no ARG in apps/web/Dockerfile`,
      ).toMatch(new RegExp(`^ARG ${name}\\b`, "m"));
      expect(webArgs, `${name} is not passed under the web service's build.args`).toMatch(
        new RegExp(`^\\s*${name}:`, "m"),
      );
    }
  });

  // Postgres holds the whole book; exposing it on the public interface is the
  // one mistake in this file that cannot be undone by editing it later.
  it("keeps Postgres bound to loopback", () => {
    // The host port is configurable (POSTGRES_PORT) because 5432 is so often
    // already taken, but the 127.0.0.1 prefix is not up for configuration:
    // that is what keeps the database off the public interface. Assert the
    // binding, not the number.
    const dbBlock = serviceBlock(compose, "db");
    expect(dbBlock).toMatch(/"127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432"/);
    expect(dbBlock).not.toMatch(/^\s*-\s*"?\d+:5432"?\s*$/m);
  });
});
