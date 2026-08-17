import type { Renderer, FrameData, Camera } from "./types";
import { viewProjection } from "./mat";
import { VISUAL, glslConstants } from "./visuals";

const GC = glslConstants();

const PARTICLE_VS = `#version 300 es
${GC}
layout(location=0) in vec3 aPos;
layout(location=1) in float aDensity;
layout(location=2) in float aSpeed;
uniform mat4 uViewProj;
uniform float uDpr;
uniform float uTemp;
out float vDensity;
out float vHeat;
void main(){
  gl_Position = uViewProj * vec4(aPos, 1.0);
  float speedN = clamp(aSpeed * SPEED_REF, 0.0, 1.0);
  vHeat = clamp(uTemp * (HEAT_BASE + HEAT_DENS * aDensity) + HEAT_SPEED * speedN, 0.0, 1.0);
  vDensity = aDensity;
  float sizePx = SIZE_BASE * (SIZE_FLOOR + SIZE_DENS * aDensity);
  gl_PointSize = clamp(sizePx, SIZE_MIN_PX, SIZE_MAX_PX) * uDpr;
}`;

const PARTICLE_FS = `#version 300 es
precision highp float;
${GC}
in float vDensity;
in float vHeat;
uniform float uPhaseF;
out vec4 frag;
vec3 palette(float x){
  return x > 0.5 ? mix(COL_MID, COL_HOT, (x - 0.5) * 2.0)
                 : mix(COL_COOL, COL_MID, x * 2.0);
}
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  float core = exp(-r * r * FALLOFF_CORE);
  float glow = exp(-r * r * FALLOFF_GLOW) * GLOW_WEIGHT;
  float mask = (core + glow) * (1.0 - smoothstep(1.0 - EDGE_SOFT, 1.0, r));
  if (mask <= 0.0) discard;
  vec3 col = palette(vHeat);
  float sat = mix(SAT_MIN, SAT_MAX, uPhaseF);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, sat);
  float bright = BASE_INTENSITY
    * (DENS_FLOOR + DENS_GAIN * vDensity)
    * (TEMP_FLOOR + TEMP_GAIN * vHeat);
  frag = vec4(col * bright * mask, mask);
}`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 vUv;
void main(){
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
${GC}
in vec2 vUv;
uniform sampler2D uScene;
out vec4 frag;
void main(){
  vec3 c = texture(uScene, vUv).rgb;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(
    BLOOM_THRESHOLD - BLOOM_KNEE,
    BLOOM_THRESHOLD + BLOOM_KNEE,
    luma
  );
  frag = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform int uMode;
out vec4 frag;
void main(){
  vec2 dir = uMode == 0 ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec3 sum = texture(uTex, vUv).rgb * 0.2;
  for (int i = 1; i < 5; i++){
    float o = float(i);
    float w = exp(-o * o * 0.18) * 0.12;
    vec2 d = dir * o;
    sum += texture(uTex, vUv + d).rgb * w;
    sum += texture(uTex, vUv - d).rgb * w;
  }
  frag = vec4(sum, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
${GC}
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uPhaseF;
out vec4 frag;
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main(){
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 bg = mix(BG_BOT, BG_TOP, vUv.y);
  float dist = distance(vUv, vec2(0.5));
  float vig = 1.0 - BG_VIGNETTE * smoothstep(0.2, 0.9, dist);
  float bloomPhase = mix(BLOOM_PHASE_HI, BLOOM_PHASE_LO, uPhaseF);
  vec3 col = bg * vig + scene + bloom * (BLOOM_INTENSITY * bloomPhase);
  col *= EXPOSURE;
  col = aces(col);
  col = pow(col, vec3(1.0 / GAMMA));
  frag = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;

  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);

    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || "shader error");
    }

    gl.attachShader(p, s);
  }

  gl.linkProgram(p);

  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "link error");
  }

  return p;
}

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    w,
    h,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0,
  );

  return { tex, fbo };
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
  });

  if (!ctx) throw new Error("WebGL2 unavailable");

  const gl: WebGL2RenderingContext = ctx;

  if (!gl.getExtension("EXT_color_buffer_float")) {
    throw new Error("float render targets unavailable");
  }

  const particleProg = compile(gl, PARTICLE_VS, PARTICLE_FS);
  const brightProg = compile(gl, QUAD_VS, BRIGHT_FS);
  const blurProg = compile(gl, QUAD_VS, BLUR_FS);
  const compositeProg = compile(gl, QUAD_VS, COMPOSITE_FS);

  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  const emptyVao = gl.createVertexArray()!;

  let w = 1;
  let h = 1;
  let currentDpr = 1;

  let scene = makeTarget(gl, 1, 1);
  let ping = makeTarget(gl, 1, 1);
  let pong = makeTarget(gl, 1, 1);

  function resize(width: number, height: number, dpr: number) {
    const nextW = Math.max(1, Math.floor(width * dpr));
    const nextH = Math.max(1, Math.floor(height * dpr));

    if (nextW === w && nextH === h) {
      currentDpr = dpr;
      return;
    }

    w = nextW;
    h = nextH;
    currentDpr = dpr;

    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    gl.deleteTexture(scene.tex);
    gl.deleteFramebuffer(scene.fbo);

    gl.deleteTexture(ping.tex);
    gl.deleteFramebuffer(ping.fbo);

    gl.deleteTexture(pong.tex);
    gl.deleteFramebuffer(pong.fbo);

    scene = makeTarget(gl, w, h);
    ping = makeTarget(gl, Math.max(1, w >> 1), Math.max(1, h >> 1));
    pong = makeTarget(gl, Math.max(1, w >> 1), Math.max(1, h >> 1));
  }

  function drawQuad() {
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(frame: FrameData, cam: Camera) {
    const vp = viewProjection(cam, w / h);
    const dpr = currentDpr;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // --- Particles into HDR scene target, additive ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, w, h);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(particleProg);

    gl.uniformMatrix4fv(
      gl.getUniformLocation(particleProg, "uViewProj"),
      false,
      vp,
    );

    gl.uniform1f(
      gl.getUniformLocation(particleProg, "uDpr"),
      dpr,
    );

    gl.uniform1f(
      gl.getUniformLocation(particleProg, "uTemp"),
      frame.temperature,
    );

    gl.uniform1f(
      gl.getUniformLocation(particleProg, "uPhaseF"),
      frame.phase / 3.0,
    );

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

    // [x,y,z,density,speed] => 5 float32 values => 20 bytes.
    gl.bufferData(gl.ARRAY_BUFFER, frame.buffer, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(
      0,
      3,
      gl.FLOAT,
      false,
      20,
      0,
    );

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(
      1,
      1,
      gl.FLOAT,
      false,
      20,
      12,
    );

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(
      2,
      1,
      gl.FLOAT,
      false,
      20,
      16,
    );

    // SIZE_MAX_PX is the shared logical sprite-size cap.
    // The WebGL implementation will additionally clamp point size to its
    // implementation-defined ALIASED_POINT_SIZE_RANGE.
    gl.drawArrays(gl.POINTS, 0, frame.count);

    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // --- Bright pass (half res) ---
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);

    gl.viewport(0, 0, hw, hh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ping.fbo);
    gl.useProgram(brightProg);

    bindTex(
      gl,
      brightProg,
      "uScene",
      scene.tex,
      0,
    );

    drawQuad();

    // --- Separable blur ping<->pong ---
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pong.fbo);
      gl.useProgram(blurProg);

      gl.uniform2f(
        gl.getUniformLocation(blurProg, "uTexel"),
        1 / hw,
        1 / hh,
      );

      gl.uniform1i(
        gl.getUniformLocation(blurProg, "uMode"),
        0,
      );

      bindTex(
        gl,
        blurProg,
        "uTex",
        ping.tex,
        0,
      );

      drawQuad();

      gl.bindFramebuffer(gl.FRAMEBUFFER, ping.fbo);

      gl.uniform1i(
        gl.getUniformLocation(blurProg, "uMode"),
        1,
      );

      bindTex(
        gl,
        blurProg,
        "uTex",
        pong.tex,
        0,
      );

      drawQuad();
    }

    // --- Composite + tone map to the default non-sRGB framebuffer ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(compositeProg);

    bindTex(
      gl,
      compositeProg,
      "uScene",
      scene.tex,
      0,
    );

    bindTex(
      gl,
      compositeProg,
      "uBloom",
      ping.tex,
      1,
    );

    gl.uniform1f(
      gl.getUniformLocation(compositeProg, "uPhaseF"),
      frame.phase / 3.0,
    );

    drawQuad();
  }

  function dispose() {
    [particleProg, brightProg, blurProg, compositeProg].forEach((p) =>
      gl.deleteProgram(p),
    );

    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
    gl.deleteVertexArray(emptyVao);

    [scene, ping, pong].forEach((t) => {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    });
  }

  return {
    backend: "webgl2",
    resize,
    render,
    dispose,
  };
}

function bindTex(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  name: string,
  tex: WebGLTexture,
  unit: number,
) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(
    gl.getUniformLocation(prog, name),
    unit,
  );
}