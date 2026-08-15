import type { ProjectEntry } from "./manifest.types";

/**
 * THE EXTENSION POINT.
 * To add a project: append one entry below. For an internal satellite, also
 * drop a self-contained folder in app/projects/<slug>. Do NOT edit the shell's
 * components, layout, or nav — they derive from this list.
 */
export const projects: ProjectEntry[] = [
  {
    slug: "distill",
    title: "Distill",
    description:
      "Get a dense, structural layout summary for LLMs.",
    tags: ["TypeScript", "Route Handler", "Multi-language"],
    status: "live",
    link: { kind: "internal", href: "/projects/distill" },
    year: 2026,
  },
  {
    slug: "bigbang",
    title: "Big Bang",
    description:
      "A GPU-accelerated WebGL2 particle simulation of the Big Bang.",
    tags: ["TypeScript", "React", "WebGL2", "GLSL", "GPU Particles", "Transform Feedback"],
    status: "live",
    link: { kind: "internal", href: "/projects/bigbang" },
    year: 2026,
  },
];
