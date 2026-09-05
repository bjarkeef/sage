## Design system

All UI work follows `packages/ui/DESIGN.md` — tokens, primitives, and the
readable-row/mono/caps contracts. Compose pages from @sage/ui primitives;
never inline card shells, arbitrary font sizes, or off-token radii.

Forms use `Field` / `FieldRow` from @sage/ui. Never name a control with only a
placeholder — it disappears on first keystroke. `label-caps` is a caps eyebrow
over a figure, never a form label.

## Verification gates

`pnpm check` runs lint + typecheck + prettier. **It does not run tests.** Before
committing, run the whole package suite, not just the file you touched —
`cd apps/web && npx vitest run`. A change that renames a label or a query can
turn another suite red while `pnpm check` stays green; this has happened.

Before a merge: `pnpm test` (whole monorepo).

Also before a merge: update `docs/roadmap.md`. It is git-ignored — a working
journal, not published documentation — but it calls itself the single source of
truth for phase progress, so a stale entry is not a gap but a false statement.
It drifted a week in August 2026 and ended up listing a shipped gate as still
blocking. Move the **Now** paragraph to what actually just landed, and tick the
boxes the work closed. A fresh clone will not have it; it lives on the
maintainer's machine.

## Test fixtures

Never paste a real broker export into a test. This repo is public. Fixtures
seeded from one spread further than anyone expected: importer tests, unrelated
suites, even a docblock, and individually none of them looked like a problem.
Together they described one person's portfolio.

Invent a ticker that keeps the shape under test and says what it is for:
`THAMES.L` for the LSE suffix, `DUOMO.MI` for Milan, `NORDA-B` for a
hyphenated Copenhagen listing. Universal placeholders (AAPL, MSFT, KO, O) are
fine and stay — they reveal nothing.

`sage-hygiene/no-identifying-tickers` enforces this for any symbol carrying an
exchange suffix: they must appear in the `ALLOWED` set in the rule, comments
included. It is an allowlist, not a list of banned symbols — a denylist would
have to reprint the very tickers the sweep removed, and would not catch the
next export somebody pastes in. So adding `KRONIX.CO` means adding it to the
rule too; that friction is the point. If a real symbol is genuinely
load-bearing, as in `yahoo.live.ts`, exempt the file and say why.

Bare US-style tickers are not machine-checked — nothing distinguishes a real
holding from the universal placeholders — so that part is on you.

## Running the app

`pnpm dev` from the repo root starts Postgres in Docker, the API (:3001) and the
web app (:3000) together. `curl localhost:3001/health` returns `{"status":"ok"}`
once the API is up; a 503 means it is running without a database.

## Worktrees

Create feature worktrees with the **EnterWorktree** tool, not `git worktree add`.
A session that starts inside a manually-created worktree is isolated to it and
cannot clean itself up afterwards — worktree removal has to run from outside the
worktree, and the isolation guard blocks that. `EnterWorktree` pairs with
`ExitWorktree(action: "remove")`, which removes the worktree and its branch and
restores the original directory in one step.

If a manually-created worktree does need removing, it is usually `locked` while a
session is attached: `git worktree unlock <path>` first, then
`git worktree remove <path>`.

**Git-ignored files do not exist inside a worktree.** A worktree is populated
from the index, so `docs/roadmap.md`, `docs/superpowers/` and anything else in
`.gitignore` are simply absent there. Since the roadmap has to be updated as the
final step of every task, that update belongs in the main checkout — editing it
from a worktree fails with "no such file", and creating it there would produce a
second, divergent copy. The same applies to `.env`.

A worktree also starts with no `node_modules`; run `pnpm install` before any
`vitest` or `pnpm check` in one.
