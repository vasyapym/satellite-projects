/**
 * GLSL ES 3.00 shader sources for the Big Bang satellite.
 * Kept as string constants because the supplied Next.js/TS build has no
 * .glsl asset loader; embedding avoids build-system changes [[1]].
 */

/* ---- Simulation pass (transform feedback; no fragment output) ---- */

export const SIM_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_velocity;
layout(location = 2) in vec3 a_seed;
layout(location = 3) in vec3 a_dir;

uniform float u_time;   // normalized [0,1]
uniform float u_dt;     // simulation delta (already speed-scaled)

out vec3 v_position;
out vec3 v_velocity;

// Smooth phase weight peaking within [a,b] via overlapping smoothsteps.
float band(float t, float a, float b, float fade) {
  float lo = smoothstep(a - fade, a + fade, t);
  float hi = 1.0 - smoothstep(b - fade, b + fade, t);
  return clamp(min(lo, hi), 0.0, 1.0);
}

void main() {
  float t = u_time;

  // Phase weights (boundaries mirror simulation.ts PHASES).
  float wSingularity = 1.0 - smoothstep(0.04, 0.1, t);
  float wInflation   = band(t, 0.08, 0.3, 0.05);
  float wExpansion   = band(t, 0.3, 0.62, 0.08);
  float wCooling     = band(t, 0.55, 0.85, 0.08);
  float wStructure   = smoothstep(0.75, 0.9, t);

  vec3 pos = a_position;
  vec3 vel = a_velocity;

  float r = length(pos) + 1e-5;
  vec3 outward = pos / r;

  // Singularity: hold particles concentrated, damp motion hard.
  vel *= mix(1.0, 0.85, wSingularity);

  // Inflation: sharp outward acceleration.
  vel += outward * (2.4 * wInflation) * u_dt;

  // Expansion: gentler continued push, more separation.
  vel += outward * (0.5 * wExpansion) * u_dt;

  // Cooling: reduce turbulence / energy.
  float turbulence = (a_seed.x - 0.5) * 2.0;
  vec3 jitter = a_dir * turbulence * 0.15 * (1.0 - wCooling);
  vel += jitter * u_dt;

  // Structure: coherent pull along shared directions -> filaments/clusters.
  // Attract toward a point offset along the particle's structural axis.
  vec3 target = a_dir * (0.6 + a_seed.y * 0.5);
  vec3 toTarget = target - pos;
  vel += toTarget * (0.8 * wStructure) * u_dt;

  // Global damping keeps the system bounded and stable.
  vel *= 0.985;

  pos += vel * u_dt;

  // Soft bound so coordinates never explode (protects precision).
  float maxR = 2.2;
  float rr = length(pos);
  if (rr > maxR) {
    pos *= maxR / rr;
    vel *= 0.5;
  }

  v_position = pos;
  v_velocity = vel;

  gl_Position = vec4(0.0); // unused; rasterizer discard is on.
}
`;

// A no-op fragment shader is still required to link the program.
export const SIM_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

/* ---- Render pass ---- */

export const RENDER_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_velocity;
layout(location = 2) in vec3 a_seed;

uniform float u_time;
uniform float u_aspect;
uniform float u_pixelRatio;

out float v_temp;
out float v_seed;

void main() {
  // Normalized temperature: hot early, cools over the lifecycle.
  float temp = 1.0 - smoothstep(0.1, 0.85, u_time);
  v_temp = temp;
  v_seed = a_seed.z;

  // Simple perspective camera, gently orbiting.
  float angle = u_time * 0.6;
  float ca = cos(angle), sa = sin(angle);
  vec3 p = a_position;
  vec3 rp = vec3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);

  float camDist = 3.2;
  vec3 eye = vec3(0.0, 0.0, camDist);
  vec3 view = rp - eye;

  float fov = 1.2;
  float f = 1.0 / tan(fov * 0.5);
  float near = 0.1, far = 20.0;
  float z = view.z;

  vec4 clip;
  clip.x = (view.x * f / u_aspect);
  clip.y = (view.y * f);
  clip.z = (far + near) / (near - far) * z + (2.0 * far * near) / (near - far);
  clip.w = -z;
  gl_Position = clip;

  // Point size: larger when hot, attenuated by distance and speed.
  float speed = length(a_velocity);
  float base = mix(1.5, 4.5, temp) + speed * 6.0;
  gl_PointSize = clamp(base * u_pixelRatio * (camDist / -z), 1.0, 40.0);
}
`;

export const RENDER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in float v_temp;
in float v_seed;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;

  // Soft luminous falloff.
  float glow = exp(-d * d * 7.0);

  // Hot -> blue-white; cool -> warm amber/red.
  vec3 hot = vec3(0.65, 0.8, 1.0);
  vec3 cool = vec3(1.0, 0.55, 0.28);
  vec3 color = mix(cool, hot, v_temp);

  // Subtle per-particle variance.
  color *= 0.75 + v_seed * 0.4;

  float alpha = glow * mix(0.35, 0.9, v_temp);
  fragColor = vec4(color * alpha, alpha);
}
`;
