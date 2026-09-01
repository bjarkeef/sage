# Security policy

## Reporting a vulnerability

Report it privately through GitHub: **[Security → Report a
vulnerability](https://github.com/bjarkeef/sage/security/advisories/new)**. That
opens a draft advisory only you and the maintainer can see.

Please don't open a public issue for anything exploitable, and please don't
test against an instance you don't own.

Sage is maintained by one person, so expect a first reply within about a week.
If you've had no response after that, open a public issue saying only that you
are waiting on a security report, with no details.

## What's in scope

The code in this repository: the API (`apps/api`), the web app (`apps/web`),
the shared packages, and the Docker Compose deployment as shipped. Things worth
reporting include authentication and session handling, one account reaching
another's portfolio data, injection of any kind, and anything that turns a
self-hosted instance into a way into the machine running it.

## What isn't

- **Findings against a deployment you don't control.** Sage is self-hosted;
  each instance belongs to whoever runs it.
- **Missing hardening a self-hoster is expected to add**, such as TLS
  termination, a firewall, or a reverse proxy. `docs/DEPLOYMENT.md` says what
  the project assumes you provide.
- **Third-party market-data providers.** Report those to the provider.
- **Vulnerabilities in transitive build-time dependencies** with no path to
  running code, unless you can show that path.

## Supported versions

There are no releases yet. `main` is the only supported version, and fixes land
there. Self-hosters should pull and rebuild rather than wait for a tag.

## Known design decisions

These are deliberate, documented, and not vulnerabilities:

- **Sage sends no email**, so there is no password-reset link to phish.
  Recovery runs from a shell on the machine
  (`docker compose exec -it api sage reset-password`).
- **Signup is open until you close it.** A fresh instance lets the first
  visitor create an account; `ALLOW_SIGNUP=false` shuts it after yours. An
  instance exposed to the internet before that is a real problem, and the
  deployment docs say so.
- **Company logos and news thumbnails are off by default**, because loading
  either tells a third party which company it is for.
  `NEXT_PUBLIC_LOGO_DEV_TOKEN` and `NEXT_PUBLIC_NEWS_THUMBNAILS` turn them on;
  `.env.example` states what each discloses. With both unset, nothing in Sage
  sends a third party anything about your positions. Reports of _other_
  undocumented outbound requests are very welcome.
