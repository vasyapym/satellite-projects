/**
 * Simulation configuration + phase model for the Big Bang satellite.
 *
 * This module is the ONE source of truth for the normalized timeline and the
 * phase boundaries. The renderer feeds normalized time to the GPU; the React
 * UI derives its phase label from the SAME thresholds here, so the two never
 * disagree without any GPU readback.
 */

export const PARTICLE_COUNT = 120_000;

/** Seconds of wall-clock the full lifecycle takes at speed = 1. */
export const CYCLE_SECONDS = 42;

/** Bytes/floats per dynamic particle state vertex: position(3) + velocity(3). */
export const DYNAMIC_STRIDE_FLOATS = 6;

/** Immutable per-particle attributes: seed(3) + structureDir(3). */
export const STATIC_STRIDE_FLOATS = 6;

export interface Phase {
  readonly key: string;
  readonly label: string;
  /** Normalized start time in [0, 1). */
  readonly start: number;
}

/**
 * Phase boundaries on the normalized [0,1] timeline. `start` is inclusive; a
 * phase runs until the next phase's start (the last runs to 1.0).
 */
export const PHASES: readonly Phase[] = [
  { key: "singularity", label: "Singularity", start: 0.0 },
  { key: "inflation", label: "Inflation", start: 0.08 },
  { key: "expansion", label: "Expansion", start: 0.3 },
  { key: "cooling", label: "Cooling", start: 0.58 },
  { key: "structure", label: "Structure Formation", start: 0.8 },
] as const;

/** Resolve the human-readable phase label for a normalized time t in [0,1]. */
export function phaseLabelAt(t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  let current = PHASES[0];
  for (const p of PHASES) {
    if (clamped >= p.start) current = p;
    else break;
  }
  return current.label;
}

/**
 * Small, fast, deterministic PRNG (mulberry32). Keeps initial state
 * reproducible so Restart always yields the same universe.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface InitialState {
  /** Dynamic state: [x,y,z, vx,vy,vz] * PARTICLE_COUNT. */
  dynamic: Float32Array;
  /** Static attributes: [seedA,seedB,seedC, dirX,dirY,dirZ] * PARTICLE_COUNT. */
  static: Float32Array;
}

/**
 * Deterministic volumetric seed cloud. Particles begin concentrated near the
 * origin with tiny outward-biased velocities. Immutable attributes carry a
 * per-particle random triplet plus a coherent structural direction drawn from
 * a small set of shared attractor axes (so structure forms filaments, not
 * uncorrelated noise) [[1]].
 */
export function createInitialState(seed = 0x9e3779b9): InitialState {
  const rand = mulberry32(seed);
  const n = PARTICLE_COUNT;
  const dynamic = new Float32Array(n * DYNAMIC_STRIDE_FLOATS);
  const staticData = new Float32Array(n * STATIC_STRIDE_FLOATS);

  // A small basis of coherent attractor directions -> large-scale structure.
  const AXES = 6;
  const axes: Array<[number, number, number]> = [];
  for (let i = 0; i < AXES; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    axes.push([r * Math.cos(theta), u, r * Math.sin(theta)]);
  }

  for (let i = 0; i < n; i++) {
    const d = i * DYNAMIC_STRIDE_FLOATS;
    const s = i * STATIC_STRIDE_FLOATS;

    // Tight volumetric distribution near the origin (cube-root for even fill).
    const radius = Math.cbrt(rand()) * 0.06;
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - u * u));
    const nx = ring * Math.cos(phi);
    const ny = u;
    const nz = ring * Math.sin(phi);

    dynamic[d] = nx * radius;
    dynamic[d + 1] = ny * radius;
    dynamic[d + 2] = nz * radius;

    // Small initial outward jitter.
    const v = 0.02 * rand();
    dynamic[d + 3] = nx * v + (rand() - 0.5) * 0.01;
    dynamic[d + 4] = ny * v + (rand() - 0.5) * 0.01;
    dynamic[d + 5] = nz * v + (rand() - 0.5) * 0.01;

    // Immutable seed triplet.
    staticData[s] = rand();
    staticData[s + 1] = rand();
    staticData[s + 2] = rand();

    // Coherent structural direction: blend two nearby shared axes.
    const a = axes[i % AXES];
    const b = axes[(i * 7 + 3) % AXES];
    const w = staticData[s];
    let dx = a[0] * w + b[0] * (1 - w);
    let dy = a[1] * w + b[1] * (1 - w);
    let dz = a[2] * w + b[2] * (1 - w);
    const len = Math.hypot(dx, dy, dz) || 1;
    staticData[s + 3] = dx / len;
    staticData[s + 4] = dy / len;
    staticData[s + 5] = dz / len;
  }

  return { dynamic, static: staticData };
}
