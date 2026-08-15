# ADR 0001 — Shell-plus-Satellites architecture

## Status
Accepted — 2026-08-11

## Context
The brief asks for a minimal portfolio that also supports adding new
sub-projects as isolated, independently-deployable modules without modifying
the core shell. Two directives pull against each other: "start minimal" vs.
"support independent deployability."

Candidate models considered:
1. **Monolith** — every project a folder in one app/build. Great early
   locality, but fails independent deployability the moment a project needs a
   Rust/Python binary, and forces a full rebuild per project.
2. **Full federation** — thin orchestrator, every project its own repo/
   container wired via module federation/proxying. Satisfies isolation but is
   wildly premature for a portfolio whose second project does not yet exist.
3. **Shell-plus-satellites (chosen)** — a lightweight shell owns landing, nav,
   identity, and a manifest; each satellite sits behind a link/URL seam that
   can start as a folder and graduate to a deployed service on demand.

## Decision
- Adopt the shell-plus-satellites model.
- The **manifest** is the single extension point.
- The **link/URL boundary** is the seam contract; upgrade to proxy/embed only
  on demonstrated need.

## Consequences
- Adding a project is data-driven (a manifest entry), not a code change to the
  shell.
- Deletion test: the manifest concentrates "what projects exist" into one
  place. Deleting it would smear that knowledge across nav, sitemap, and
  landing — so it earns its keep.
