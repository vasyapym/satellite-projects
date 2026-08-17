// apps/shell/app/projects/bigbang_rust/renderer/visual.ts
//
// SINGLE SOURCE OF TRUTH for the Big Bang look.
// Both backends import these numbers and inject them into their shader source,
// so the WebGPU and WebGL2 pipelines can never diverge numerically.

export const VISUAL = {
  // per-particle heat model: heat = temp*(BASE + DENS*density) + SPEED*speedN
  SPEED_REF: 6.0,
  HEAT_BASE: 0.55,
  HEAT_DENS: 0.65,
  HEAT_SPEED: 0.2,

  // palette stops (linear RGB): cooled -> warm -> hot core
  COL_COOL: [0.55, 0.1, 0.16],
  COL_MID: [1.0, 0.55, 0.22],
  COL_HOT: [0.75, 0.85, 1.0],

  // HDR brightness
  BASE_INTENSITY: 1.6,
  DENS_FLOOR: 0.35,
  DENS_GAIN: 1.25,
  TEMP_FLOOR: 0.6,
  TEMP_GAIN: 0.8,

  // soft round sprite
  FALLOFF_CORE: 7.0,
  FALLOFF_GLOW: 2.0,
  GLOW_WEIGHT: 0.35,
  EDGE_SOFT: 0.06,

  // sprite size (pixels, pre-DPR). SIZE_MAX_PX is also the WebGPU quad cap
  // so both backends clamp identically (backend parity vs the point-size cap).
  SIZE_BASE: 6.0,
  SIZE_FLOOR: 0.5,
  SIZE_DENS: 1.5,
  SIZE_MIN_PX: 2.0,
  SIZE_MAX_PX: 32.0,

  // phase modulation (phaseF = phase/3, 0..1)
  SAT_MIN: 0.85,
  SAT_MAX: 1.15,
  BLOOM_PHASE_HI: 1.25, // inflation blooms hard
  BLOOM_PHASE_LO: 0.8,  // structure formation calmer

  // post
  EXPOSURE: 1.1,
  BLOOM_THRESHOLD: 1.0,
  BLOOM_KNEE: 0.2,
  BLOOM_INTENSITY: 0.85,
  GAMMA: 2.2,

  // background
  BG_TOP: [0.02, 0.03, 0.06],
  BG_BOT: [0.0, 0.0, 0.01],
  BG_VIGNETTE: 0.35,
} as const;

type Vec3 = readonly [number, number, number];
const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const gv = (v: Vec3) => `vec3(${f(v[0])},${f(v[1])},${f(v[2])})`;
const wv = (v: Vec3) => `vec3<f32>(${f(v[0])},${f(v[1])},${f(v[2])})`;
const V = VISUAL;

/** GLSL ES 3.00 constant preamble (insert right after the #version line). */
export function glslConstants(): string {
  return `
const float SPEED_REF=${f(V.SPEED_REF)};
const float HEAT_BASE=${f(V.HEAT_BASE)};
const float HEAT_DENS=${f(V.HEAT_DENS)};
const float HEAT_SPEED=${f(V.HEAT_SPEED)};
const vec3  COL_COOL=${gv(V.COL_COOL)};
const vec3  COL_MID=${gv(V.COL_MID)};
const vec3  COL_HOT=${gv(V.COL_HOT)};
const float BASE_INTENSITY=${f(V.BASE_INTENSITY)};
const float DENS_FLOOR=${f(V.DENS_FLOOR)};
const float DENS_GAIN=${f(V.DENS_GAIN)};
const float TEMP_FLOOR=${f(V.TEMP_FLOOR)};
const float TEMP_GAIN=${f(V.TEMP_GAIN)};
const float FALLOFF_CORE=${f(V.FALLOFF_CORE)};
const float FALLOFF_GLOW=${f(V.FALLOFF_GLOW)};
const float GLOW_WEIGHT=${f(V.GLOW_WEIGHT)};
const float EDGE_SOFT=${f(V.EDGE_SOFT)};
const float SIZE_BASE=${f(V.SIZE_BASE)};
const float SIZE_FLOOR=${f(V.SIZE_FLOOR)};
const float SIZE_DENS=${f(V.SIZE_DENS)};
const float SIZE_MIN_PX=${f(V.SIZE_MIN_PX)};
const float SIZE_MAX_PX=${f(V.SIZE_MAX_PX)};
const float SAT_MIN=${f(V.SAT_MIN)};
const float SAT_MAX=${f(V.SAT_MAX)};
const float BLOOM_PHASE_HI=${f(V.BLOOM_PHASE_HI)};
const float BLOOM_PHASE_LO=${f(V.BLOOM_PHASE_LO)};
const float EXPOSURE=${f(V.EXPOSURE)};
const float BLOOM_THRESHOLD=${f(V.BLOOM_THRESHOLD)};
const float BLOOM_KNEE=${f(V.BLOOM_KNEE)};
const float BLOOM_INTENSITY=${f(V.BLOOM_INTENSITY)};
const float GAMMA=${f(V.GAMMA)};
const vec3  BG_TOP=${gv(V.BG_TOP)};
const vec3  BG_BOT=${gv(V.BG_BOT)};
const float BG_VIGNETTE=${f(V.BG_VIGNETTE)};
`;
}

/** WGSL constant preamble (prepend to each WGSL module string). */
export function wgslConstants(): string {
  return `
const SPEED_REF:f32=${f(V.SPEED_REF)};
const HEAT_BASE:f32=${f(V.HEAT_BASE)};
const HEAT_DENS:f32=${f(V.HEAT_DENS)};
const HEAT_SPEED:f32=${f(V.HEAT_SPEED)};
const COL_COOL:vec3<f32>=${wv(V.COL_COOL)};
const COL_MID:vec3<f32>=${wv(V.COL_MID)};
const COL_HOT:vec3<f32>=${wv(V.COL_HOT)};
const BASE_INTENSITY:f32=${f(V.BASE_INTENSITY)};
const DENS_FLOOR:f32=${f(V.DENS_FLOOR)};
const DENS_GAIN:f32=${f(V.DENS_GAIN)};
const TEMP_FLOOR:f32=${f(V.TEMP_FLOOR)};
const TEMP_GAIN:f32=${f(V.TEMP_GAIN)};
const FALLOFF_CORE:f32=${f(V.FALLOFF_CORE)};
const FALLOFF_GLOW:f32=${f(V.FALLOFF_GLOW)};
const GLOW_WEIGHT:f32=${f(V.GLOW_WEIGHT)};
const EDGE_SOFT:f32=${f(V.EDGE_SOFT)};
const SIZE_BASE:f32=${f(V.SIZE_BASE)};
const SIZE_FLOOR:f32=${f(V.SIZE_FLOOR)};
const SIZE_DENS:f32=${f(V.SIZE_DENS)};
const SIZE_MIN_PX:f32=${f(V.SIZE_MIN_PX)};
const SIZE_MAX_PX:f32=${f(V.SIZE_MAX_PX)};
const SAT_MIN:f32=${f(V.SAT_MIN)};
const SAT_MAX:f32=${f(V.SAT_MAX)};
const BLOOM_PHASE_HI:f32=${f(V.BLOOM_PHASE_HI)};
const BLOOM_PHASE_LO:f32=${f(V.BLOOM_PHASE_LO)};
const EXPOSURE:f32=${f(V.EXPOSURE)};
const BLOOM_THRESHOLD:f32=${f(V.BLOOM_THRESHOLD)};
const BLOOM_KNEE:f32=${f(V.BLOOM_KNEE)};
const BLOOM_INTENSITY:f32=${f(V.BLOOM_INTENSITY)};
const GAMMA:f32=${f(V.GAMMA)};
const BG_TOP:vec3<f32>=${wv(V.BG_TOP)};
const BG_BOT:vec3<f32>=${wv(V.BG_BOT)};
const BG_VIGNETTE:f32=${f(V.BG_VIGNETTE)};
`;
}