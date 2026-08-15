# CONTEXT — Domain Glossary

This repository is a **portfolio that doubles as an extensible platform** for
hosting self-contained pet projects. It starts minimal and grows incrementally,
favoring cohesive modules with clean seams over premature abstraction.

## Vocabulary

- **Shell** — the Next.js/TypeScript application that owns the landing page,
  the shared visual identity (design tokens + layout primitives), and the
  single source of truth about which projects exist. The shell stays boring,
  stable, and monoglot on purpose.

- **Satellite** — a self-contained pet project. Starts life as an internal
  route folder inside the shell (`app/projects/<slug>`), and may graduate into
  an independently-deployed service without the shell logic changing.

- **Manifest** (`lib/manifest.ts`) — the shell's designed extension point. A
  typed list of project entries. Adding a project = adding a manifest entry
  (+ dropping a folder, for internal satellites). The landing page and the
  navigation are both derived from it; neither hard-codes projects.

- **Seam** — the boundary between shell and satellite. Its primary form is a
  URL/link. It upgrades to reverse-proxy/embed only when a satellite genuinely
  needs to feel native. A link is the cheapest real seam between two systems.

## Non-negotiables

- Adding a satellite MUST NOT require editing shell logic, layout primitives,
  navigation rendering, or the token contract — only appending a manifest entry.
- Nothing is promoted to "shared" until ≥2 satellites independently need it.
