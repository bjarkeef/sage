# Contributing

Thanks for helping with Sage.

## License and the CLA

Sage is **AGPL-3.0-only** (see `LICENSE`), and every contribution ships under
that license.

External contributors are also asked to sign a **Contributor License
Agreement** — [`CLA.md`](./CLA.md) — before a pull request is merged. An
automated check posts instructions on your first PR; signing is one comment,
once, and later PRs are recognised automatically. Signatures are stored on this
repository's `cla-signatures` branch, not with a third-party service.

**You keep the copyright in your contribution.** The CLA is a license, not an
assignment. What it adds beyond AGPL is the right for the maintainer to license
the project under other terms as well.

Why that matters, stated plainly so you can decide with open eyes: the AGPL
alone already permits a managed hosted version of Sage, so the CLA is not what
enables that. What it preserves is the option to sell a separate commercial
license to an organisation that cannot accept copyleft. A single contribution
without this grant would close that option for the whole project permanently.
If you would rather not grant it, that is a legitimate position — open an issue
and we can talk about the change instead.

## Development

See `README.md` and `docs/DEPLOYMENT.md`.

```bash
corepack enable
pnpm install
cp apps/api/.env.example apps/api/.env   # set BETTER_AUTH_SECRET
pnpm dev
pnpm check   # lint + typecheck + format
pnpm test
```

### Signing in to your dev instance without typing a password

Checking a change in a real browser needs a real session. Rather than keeping a
test password somewhere — in a note, a script, or an agent's memory — mint the
session directly:

```bash
pnpm --filter @sage/api dev-session you@example.com
```

It prints `better-auth.session_token=<value>` for a user that already exists in
your local database. Send it as a cookie header (`curl --cookie "$(...)"`) or
paste it into the browser's cookie jar for `localhost`, and you are signed in.

The session is created through better-auth's own server context, so it is
issued exactly as a successful sign-in would issue it — including the HMAC
signature, without which the API answers `unauthorized`. The script refuses to
run under `NODE_ENV=production`, and lives in `apps/api/scripts/` rather than
`src/`, so esbuild never bundles it into `dist/` and it cannot reach the
shipped image — unlike the `sage` CLI, which can.

## Testing

```bash
pnpm test                     # everything
SKIP_DB_TESTS=1 pnpm test     # skip database-backed suites (no Docker needed)
```

Most of the API suite talks to a real Postgres, because the money and dividend
logic is only meaningfully tested against real SQL. To keep that affordable:

- `vitest` starts **one** `postgres:16-alpine` container per run and migrates a
  template database inside it (`apps/api/src/testing/global-setup.ts`).
- Each suite calls `withTestDb()` for a copy-on-write clone of that template
  (~46ms, versus ~2.1s for a fresh container plus migrations). The clone is
  already migrated — never call `runMigrations` from a test.
- Wrap any suite that needs a database in **`describeDb`**, not `describe`, so
  it skips cleanly under `SKIP_DB_TESTS=1`.
- Shared helpers (`testEnv`, `signUpTestUser`, `fakeAuth`) live in
  `apps/api/src/testing/`. Add to them rather than re-declaring per file.

A clone is created per suite, not per test, so tests inside one suite share a
database. Give each one a distinct user email.

Web tests run in two vitest projects: `lib/**/*.test.ts` in Node, everything
else in jsdom. A `lib/` test that needs a DOM opts in with a
`// @vitest-environment jsdom` docblock.

## Scope

- Prefer fixes and features that help **self-hosters** and the open product.
- Billing, multi-region fleet ops, and commercial-only orchestration belong in
  a separate private cloud layer — not this repo.
