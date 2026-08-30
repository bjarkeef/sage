import { readFileSync } from "node:fs";
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
