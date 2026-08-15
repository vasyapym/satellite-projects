# ADR 0002 — Satellite extraction path & deferred reservations

## Status
Accepted — 2026-08-11

## Extraction: internal route → independent service
A satellite graduates when it needs a runtime the shell can't host (Go/Rust/
Python, long-running processes, heavy deps).

1. Move the satellite into `services/<slug>/` (own repo or package), give it
   its own deploy + URL.
2. Change ONLY its manifest entry:
   `link: { kind: "internal", href: "/projects/<slug>" }`
   → `link: { kind: "external", href: "https://<slug>.example.com" }`
3. Visitor experience is unchanged — a link is still a link.
4. If it must feel native, add a reverse-proxy rewrite in `next.config.ts`
   under `/projects/<slug>/*`. Build this only when a satellite asks for it.

The shell's components/logic do NOT change during extraction. That is the test
of whether this ADR is being honored.

## Deferred reservations (triggers, not tasks)
- **PostgreSQL** — provisioned when a satellite needs durable relational state.
  Until then it would store nothing. Convention: each satellite owns its own
  schema/namespace.
- **Polyglot backend (Go/Rust/Python)** — added when a satellite's problem
  genuinely fits that language better than TypeScript. Same link/proxy seam
  applies uniformly, whatever the language.
- **Shared package promotion** — a thing becomes shared only when ≥2 satellites
  independently need it. `services/` and a future `packages/` are reserved,
  not populated speculatively.
