# Deployment model — self-host & hosted cloud

Sage is built like **Supabase / Ghostfolio**: one open-source product you can run
yourself, plus (later) a **managed hosted** offering you operate for paying
customers. This file is the durable product/legal posture for that split.

## Two ways to run the same codebase

| Mode                    | Who runs it                  | Users per instance    | Signup                                              |
| ----------------------- | ---------------------------- | --------------------- | --------------------------------------------------- |
| **Self-host**           | End user (VPS, NAS, homelab) | Usually one household | Create first account, then `ALLOW_SIGNUP=false`     |
| **Hosted (Sage Cloud)** | You (operator)               | Many customers        | `ALLOW_SIGNUP=true` (or invite flow in cloud layer) |

Both use this monorepo (`apps/api`, `apps/web`, Docker Compose). The **hosted**
product adds a separate private repo later (`sage-cloud`) for billing,
orchestration, multi-region ops — not for forking core business logic.

## What lives where

| Concern                                            | Lives in open core (`sage`) | Lives in cloud wrapper (`sage-cloud`, later) |
| -------------------------------------------------- | --------------------------- | -------------------------------------------- |
| Portfolio, dividends, charts, import               | ✅                          | —                                            |
| Per-user data isolation (portfolio-scoped queries) | ✅                          | may add org/tenant orchestration on top      |
| Auth (better-auth email/password)                  | ✅                          | SSO / enterprise IdP adapters                |
| `ALLOW_SIGNUP` lock-down                           | ✅                          | subscription-gated signup                    |
| Stripe, invoices, trial                            | —                           | ✅                                           |
| Shared multi-region infra                          | —                           | ✅                                           |

**Rule:** if a feature is useful to a self-hoster, it belongs in this repo under
AGPL. If it only exists to run a paid multi-customer service, it belongs in
`sage-cloud`.

## License (AGPL-3.0-only) — is dual use allowed?

**Yes.** AGPL is the standard “open core + hosted product” license for this
category (Ghostfolio uses the same pattern).

- **Self-hosters** get full rights to run, modify, and share under AGPL.
- **You as copyright holder** can also run a commercial hosted service. If you
  only ship the public AGPL code (or dual-license your own code), that is
  normal and intended.
- **AGPL network clause:** if someone _else_ forks Sage, modifies it, and offers
  it as a network service, they must offer the modified source to their users.
  That protects you from a freeloader cloud fork that never contributes back.
- **Commercial license (optional later):** for companies that need white-label
  without AGPL obligations, sold separately by the copyright holder.

You are **not** blocked from self-host _or_ from hosting. AGPL blocks closed
cloud forks of _other people’s_ modified versions; it does not stop the author
from offering a managed product.

### Contributors and CLA

**Active since 2026-08-13.** External pull requests must sign [`CLA.md`](../CLA.md)
before merge, enforced by `.github/workflows/cla.yml`. Signatures live on this
repo's `cla-signatures` branch, not with a third-party service.

Be precise about what this does and does not buy, because an earlier version of
this section overstated it:

- It is **not** what allows a hosted Sage. The AGPL already permits that, even
  for code others contributed — the obligation is to keep the core's source
  available, which the self-host promise commits to anyway. Billing and fleet
  orchestration sit outside the AGPL core regardless.
- It **is** what preserves the "commercial license" bullet above: selling
  white-label terms to an organisation that cannot accept copyleft requires
  rights to 100% of the code. One external contribution without that grant
  forecloses it permanently, or forces you to identify and reimplement that
  contribution years later.

The whole history is solo-authored (one email, no co-author trailers), so
there is nothing to backfill — the agreement only ever has to cover
contributors from here forward.

**One-time setup** before the check can pass — create the signature store:

```bash
git switch --orphan cla-signatures
git commit --allow-empty -m "chore: initialise CLA signature store"
git push -u origin cla-signatures
git switch main
```

**Tooling caveat, recorded deliberately.** The action is pinned to an immutable
commit SHA and its upstream repository is **archived** (last release September
2024). It is frozen rather than broken, and was still preferred because
automatically blocking the merge is the entire point — the failure this guards
against is forgetting once, and once is irreversible. The only actively
maintained tool in this space is the DCO app, which grants no relicensing
rights and so cannot do this job. If the action ever stops working, fall back to
the checkbox in `.github/pull_request_template.md` and verify the signing
comment by hand before merging.

## Self-host quick path

```bash
cp .env.example .env          # set BETTER_AUTH_SECRET (long random)
docker compose up -d --build
# open http://localhost:3000 → create your account
# then set ALLOW_SIGNUP=false in .env and recreate the API container
```

Also set real values when not on localhost:

- `AUTH_BASE_URL` — public URL of the API (cookies / better-auth)
- `WEB_ORIGIN` — public URL of the web app (CORS + trusted origins)
- `NEXT_PUBLIC_SAGE_API_URL` — browser-reachable API URL. **Build time**, not
  run time: rebuild the web container after changing it (see below)
- `SAGE_API_URL` — server-side API URL (Docker network name is fine)

**Three of those take effect on restart; `NEXT_PUBLIC_SAGE_API_URL` takes effect
on rebuild.** Next freezes `NEXT_PUBLIC_*` into the browser bundle, so editing
it and running `docker compose up -d` leaves the client calling the previously
inlined address. The failure is quiet and confusing: the page loads normally,
then every request fails against `localhost:3001` — sign-up first, before you
have an account to tell you anything is wrong. After changing it:

```bash
docker compose up -d --build web
```

## Always-on, and reaching it from your phone

Sage on a laptop you close is Sage you will stop using. The stack is built to be
left running: every service carries `restart: unless-stopped`, so a reboot or a
crashed container brings it back without anyone visiting the box. (A deliberate
`docker compose stop` still stays stopped — that is the difference from
`always`.) On Windows or macOS this means Docker Desktop needs "start on login"
set, or nothing comes back at all.

**Phone access is a URL problem, not a data problem.** There is one database. A
phone pointed at the same instance sees the same book as the desktop, live —
nothing syncs because there is only ever one copy. What trips people up is that
three of the four URLs above are consumed **by the browser**, so `localhost`
means the phone itself:

| Variable                   | Must be                                    |
| -------------------------- | ------------------------------------------ |
| `AUTH_BASE_URL`            | the address the phone will type, port 3001 |
| `WEB_ORIGIN`               | the address the phone will type, port 3000 |
| `NEXT_PUBLIC_SAGE_API_URL` | the address the phone will type, port 3001 |
| `SAGE_API_URL`             | stays `http://api:3001` — server-side only |

Miss `AUTH_BASE_URL` and everything loads until you try to sign in.

**On your own network**, use the host's LAN address:

```bash
AUTH_BASE_URL=http://192.168.1.10:3001
WEB_ORIGIN=http://192.168.1.10:3000
NEXT_PUBLIC_SAGE_API_URL=http://192.168.1.10:3001
```

Then open it on the phone and use "Add to home screen" — the manifest makes it
install as an app rather than a bookmark. Works at home only, and an active VPN
on either device will usually break the route.

**From anywhere**, the least-effort option that does not put your portfolio on
the public internet is a private overlay network — [Tailscale](https://tailscale.com)
or equivalent. Install it on the host and the phone, use the host's overlay
address in the three variables above, and Sage is reachable on mobile data with
no port forwarding, no dynamic DNS, and no certificate to renew.

### On a rented server, the URLs are not what protects you

Everything above assumes a machine on a network you trust — a NAS, a homelab
box, a laptop. **On a VPS with a public IP, following it unchanged puts your
complete financial position on the public internet.**

The trap is that the four variables look like they control access, and they do
not. They tell the _browser_ where to send requests. What decides who can reach
Sage is the `ports:` mapping, and the shipped Compose file publishes on
`0.0.0.0`:

```yaml
ports:
  - "3000:3000" # every interface, including the public one
```

That is deliberate — it is what makes the LAN address work from a phone — and
it is exactly wrong on a rented server. Setting the three URLs to a Tailscale
address does **not** undo it: the overlay address is what your phone talks to,
while `http://<public-ip>:3000` keeps answering anyone who asks.

Bind the published ports to the overlay interface instead. Put this in
`docker-compose.override.yml` next to the main file, substituting the host's
Tailscale address (`tailscale ip -4`):

```yaml
services:
  web:
    ports: !override
      - "100.101.102.103:3000:3000"
  api:
    ports: !override
      - "100.101.102.103:3001:3001"
```

`!override` is required and easy to miss. Compose _appends_ port lists when
merging an override file, so a plain `ports:` leaves the original `0.0.0.0`
binding in place alongside the new one and changes nothing about your exposure.
The same footgun is documented against `POSTGRES_PORT` in the Compose file
itself.

Verify from somewhere other than the box — a refused connection is the goal:

```bash
curl --connect-timeout 5 http://<public-ip>:3000   # must fail
curl --connect-timeout 5 http://<public-ip>:3001   # must fail
curl http://<tailscale-ip>:3000                    # must answer
```

Add a firewall as the second layer, because a Compose file is one careless edit
away from republishing. On Hetzner, prefer a Cloud Firewall in their console —
it sits in front of the machine, so a misconfigured container cannot escape it.
On the box itself, `ufw` is often _inactive_ by default; check rather than
assume, and note that Docker publishes ports by writing its own iptables rules,
which bypass `ufw` unless you have specifically configured otherwise.

**The signup window matters more here.** The instruction to set
`ALLOW_SIGNUP=false` in the same sitting as your first account is a minute of
exposure on a home LAN. On a public IP it is a minute in which anyone scanning
the address space can claim your instance. On a rented server, bind the ports
privately _before_ the first `docker compose up`, not after.

**Exposing it publicly on purpose is a different job.** You need a reverse proxy
terminating TLS and the same three URLs on `https://`. Do not skip the TLS part:
these are session cookies for an application holding your complete financial
position, and on plain HTTP over a network you do not control they are readable
in transit. Keep Postgres bound to loopback either way — the shipped compose
does, and a test fails if that changes.

## Hosted operator path (you)

1. Run the same images with **strong secrets** and **open signup** (or cloud
   invite flow).
2. Keep **one logical tenant per user/portfolio** via existing
   portfolio-scoped APIs (already enforced).
3. Put billing, custom domains, and fleet orchestration in `sage-cloud` — do
   not close-source the portfolio math.

Public config for the UI: `GET /public-config` → `{ allowSignup, mode }`.

## Market data: limits, licensing, and what breaks

Sage has **no licensed market-data feed**. This section is the operator-facing
detail behind the summary in the README; read that first if you have not.

### The providers

| `MARKET_DATA_PROVIDER`     | Key      | Free tier          | Official?                  |
| -------------------------- | -------- | ------------------ | -------------------------- |
| `yahoo` (default)          | none     | no published limit | **No** — unofficial client |
| `eodhd`                    | required | 20 API calls/day   | Yes                        |
| ECB (FX, not configurable) | none     | unrationed         | Yes                        |

EODHD **weights its endpoints**: an end-of-day price costs 1 call, news 5, and
fundamentals 10. On the **free** tier the fundamentals endpoint is paywalled
outright rather than merely expensive — it answers 403 — so asset-profile data
(sector, market cap, P/E) does not come from a free EODHD key at all. Sage
already degrades around this: `EodhdProvider.getDividendHistory` only reaches for
fundamentals when a dividend row omits its currency, and swallows the failure so
a 403 there cannot lose otherwise-good dividend data.

`ENRICHMENT_PROVIDER` accepts `yahoo` or `none` (the default) — **not `eodhd`**;
the env schema rejects it and the API will not boot. `yahoo` is the useful
setting when prices come from EODHD, because it fills the fundamentals that a
free EODHD key cannot serve.

An Alpha Vantage adapter shipped until 2026-08-17 and was removed: its free tier
capped at 5 calls a minute, which a cold portfolio load blows through instantly,
so it was never a workable primary. `MARKET_DATA_PROVIDER=alphavantage` is now
rejected at startup rather than silently ignored.

### Why the default is the unofficial one

A non-Yahoo primary automatically falls back to Yahoo for any symbol it cannot
serve — a coverage gap, or an exhausted quota. That is what makes a free tier
usable at all: 20 calls does not cover the first load of a 30-holding portfolio,
since each symbol needs its own quote. The honest consequence is that **a
free-tier configuration still depends on the unofficial path**, and a key alone
does not remove that dependency. Only a paid tier with enough call volume does.

This is also the reason a hosted Sage is not on offer: redistributing Yahoo's
data to paying users is not something its terms allow, so a hosted tier needs a
commercially licensed provider first, not merely more servers.

### What degradation actually looks like

Since prices are stored in Postgres, an outage or exhausted quota **does not
empty the app**:

| Situation                               | What the user sees                                                  |
| --------------------------------------- | ------------------------------------------------------------------- |
| Provider down, prices previously stored | Last known values, plus a notice naming the age and cause           |
| Provider down, symbol never fetched     | Unavailable for that holding only                                   |
| Quota exhausted on the primary          | Fallback to Yahoo, usually invisible                                |
| Every provider failing                  | Stored values everywhere, one instance-wide notice                  |
| FX unreachable                          | Unaffected — ECB rates are stored locally and refresh independently |

Refresh costs after the first load are modest: one call per symbol per 15 minutes
for quotes, one per symbol per 24 hours for daily bars, with history backfill
capped at 5 concurrent fetches. Dividend sync is capped at 5 symbols per trigger
on a 24-hour TTL.

`Settings → System` reports each provider's live state, the reason for the last
failure, and how old the stored prices are.

## Account recovery

Sage sends no email — there is no SMTP anywhere in the tree, deliberately, so
that a complete install stays `docker compose up`. A forgotten password is
therefore recovered from a shell on the box rather than from the app.

```bash
# Which accounts exist on this instance
docker compose exec api sage list

# Set a new password (prompts twice, nothing is echoed)
docker compose exec -it api sage reset-password you@example.com
```

The email may be omitted when the instance has exactly one account.

**What it does.** Sets the password using better-auth's own hasher — the same
code path signup uses — and then **signs that user out of every existing
session**. Your other devices will need to log in again. That is deliberate: a
reset that left old sessions running would give false comfort if someone else
knew the old password.

**Without `-it`** (in a script, or over a pipe) there is no terminal to prompt
on, so the command generates a strong password and prints it once. Change it
after signing in.

**A password is never accepted as an argument.** There is no `--password` flag,
because it would be saved in your shell history and visible in `ps` output.

Before writing anything, the command prints the database it is about to modify.
Check it if you run more than one Sage instance on the same host.

**Do not reset passwords with SQL.** better-auth stores the credential in
`account.password` in its own scrypt format, which it is free to change. A hand
written hash that is almost right produces an account that silently cannot log
in — discovered by someone who is already locked out.

## Backup and restore

The JSON export in **Settings → Your data** is a copy of what you entered — good
for reading, for moving to another tool, and for keeping alongside your records.
**It is not a backup**: there is no import for it, and it deliberately omits
Sage's internal bookkeeping.

For disaster recovery, dump the database. It is complete by construction, and
unlike an app-level export it cannot silently drift out of date as the schema
changes.

The commands below run `${POSTGRES_USER:-sage}` / `${POSTGRES_DB:-sage}`
through the **host** shell, not the container — it never reads your `.env`, so
if you customized either value there, substitute your real values in place of
these before running them.

```bash
# Snapshot (writes to the current directory)
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-sage}" -d "${POSTGRES_DB:-sage}" \
  > "sage-$(date +%F).sql"
```

Restore replaces everything in the database. Do it on a fresh volume so you are
never merging an old dump into a live schema:

```bash
# WARNING: `down -v` DELETES the current database volume. Take a dump first.
docker compose down -v
# --wait blocks until the healthcheck passes. On a fresh volume the entrypoint
# runs initdb and restarts the server, so a `psql` fired right after `up -d`
# usually hits "the database system is starting up".
docker compose up -d --wait db
docker compose exec -T db psql -U "${POSTGRES_USER:-sage}" -d "${POSTGRES_DB:-sage}" \
  < sage-2026-08-10.sql
docker compose up -d
```

Keep dumps somewhere other than the machine running Sage — a backup that dies
with the host is not one.

## Known rough edges

**A custom holding cannot be removed from the app.** You can create one and
edit it, and deleting its transactions clears the position, but there is no
delete route for the instrument itself — a custom holding with no transactions
against it stays in the instrument picker until you remove it with SQL:

```bash
docker compose exec -T db psql -U "${POSTGRES_USER:-sage}" -d "${POSTGRES_DB:-sage}" \
  -c "delete from instrument where symbol = 'YOUR-CUSTOM-SYMBOL';"
```

Its `custom_holding` settings row and any `manual_price` marks cascade from
that delete. The statement fails if the symbol still has transactions, which is
the intended guard — delete those in the app first.

## Security defaults checklist

- [x] `BETTER_AUTH_SECRET` ≥ 32 random chars — **enforced**: the API refuses to
      start under `NODE_ENV=production` (which the Compose file sets) if the
      secret is still the string from `.env.example`. Generate one with
      `openssl rand -hex 32`. Outside production the example value is accepted,
      so the dev quick start stays a single command.
- [ ] Postgres password not `sage` on any internet-facing host
- [ ] Postgres port not published to the world (Compose binds `127.0.0.1` by default)
- [ ] **On a rented server: web and API bound to a private interface before the
      first `docker compose up`**, not after. The shipped Compose publishes them
      on `0.0.0.0`, and the URL variables do not change that — see
      [On a rented server](#on-a-rented-server-the-urls-are-not-what-protects-you).
      Verify with `curl http://<public-ip>:3000` from elsewhere; it must fail.
- [ ] Firewall in front of the machine on any public host — on Hetzner, a Cloud
      Firewall rather than `ufw`, since Docker's own iptables rules bypass `ufw`
- [ ] Self-host: `ALLOW_SIGNUP=false` after first user. **Do it in the same
      sitting as the first sign-up.** Unlike Postgres, the web and API
      containers publish on `0.0.0.0`, which is what makes the LAN address
      above work from a phone — so between `docker compose up` finishing and
      this flag being set, anyone on the same network can reach the signup page
      and claim the instance. The window is usually a minute; it is not zero.
      On a public IP, "the same network" means everyone.
- [ ] HTTPS reverse proxy in front of web + API; `AUTH_BASE_URL` uses `https://`
