```markdown
Project playground. One stable **shell** renders a
landing page of project cards; each card links to a self-contained **satellite**
that can live inside the shell today and move to its own service tomorrow —
without changing the shell's code.

## Quick start

```bash
cd apps/shell
npm install
npm run dev        # → http://localhost:3000
```

Requires Node ≥ 18.18 (enforced by Next.js 15).

## Add a project

1. Open `apps/shell/lib/manifest.ts` and append an entry:

```ts
{
  slug: "my-project",
  title: "My Project",
  description: "One sentence that fits a card.",
  tags: ["Go", "CLI"],
  status: "in-progress",       // "live" | "in-progress" | "archived"
  link: { kind: "internal", href: "/projects/my-project" },
  year: 2026,
}
```

2. For a live internal satellite, also create `app/projects/my-project/page.tsx`.

That's it. The landing page, nav, and card grid derive from the manifest — no
other file needs editing. Style your satellite using **only** the CSS custom
properties in [`globals.css`](./apps/shell/app/globals.css)
(`--color-*`, `--space-*`, `--radius*`, `--font-*`).

## Project structure

```
apps/shell/             ← the Next.js shell (the only deployable today)
  app/                  ← routes: landing page + project sub-routes
  components/           ← shell-owned UI (Header, Footer, ProjectCard)
  lib/manifest.ts       ← THE extension point — one entry per satellite
  lib/manifest.types.ts ← TypeScript contract for entries
docs/adr/               ← architecture decision records
CONTEXT.md              ← domain glossary (shell, satellite, manifest, seam)
```

## How it works

The architecture is documented in three places — read them in this order if you
want the full picture:

1. [`CONTEXT.md`](./CONTEXT.md) — domain vocabulary and non-negotiables.
2. [`ADR-0001`](./docs/adr/0001-shell-plus-satellites.md) — why shell +
   satellites over monolith or federation.
3. [`ADR-0002`](./docs/adr/0002-extraction-and-reservations.md) — how a
   satellite graduates to an independent service.

The short version: the manifest is the only extension point. A link is the
cheapest real seam between two systems. Promote nothing to "shared" until two
satellites independently need it.

## Scripts

| Command | Effect |
|---------|--------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Serve production build locally |
| `npm run lint` | Run Next.js lint checks |

All commands run from `apps/shell/`.

## Tech stack

- **Next.js 15** (App Router) / React 19 / TypeScript 5
- Pure CSS design tokens — no UI framework
- No shared packages yet (deferred until ≥ 2 satellites need one)

## License

MIT
```
# Contributing

The main contribution path is adding or improving a satellite. The shell itself
is deliberately boring — change it only to fix a bug or improve the platform
contract.

## Add a satellite

cd apps/shell
```

1. **Append a manifest entry** in `lib/manifest.ts`.
   The `ProjectEntry` type will tell you what's required — follow the compiler.

2. **Create a route folder** at `app/projects/<slug>/page.tsx`.
   This is a standard Next.js page — use whatever you need inside it.

3. **Style with tokens only.** Use the CSS custom properties from `globals.css`.
   Do not import shell components into satellite code.

4. **Verify locally:**

```bash
npm run dev
# Confirm: card appears on landing page, link resolves, no console errors.
npm run lint
```

No other file needs editing.

## Ground rules

| Rule | Why |
|------|-----|
| Never edit shell components/layout/nav to add a project | If you feel the need, the manifest contract is missing something — file an issue. |
| Nothing becomes "shared" until ≥ 2 satellites need it independently | Premature extraction creates coupling without value. |
| Record non-obvious decisions in `docs/adr/` | Use the existing format, number sequentially. |

## Extract a satellite to its own service

Trigger: the satellite needs a runtime the shell can't host (Go, Rust, Python,
heavy native deps, long-running processes).

Follow the path in [ADR-0002](./docs/adr/0002-extraction-and-reservations.md).
The shell's code stays untouched — only the manifest entry changes.