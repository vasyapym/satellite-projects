import type { Renderer, FrameData, Camera } from "./types";
import { viewProjection } from "./mat";

const PARTICLE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aDensity;
layout(location=2) in float aSpeed;
uniform mat4 uVP;
uniform float uTemp;
uniform float uPointScale;
out vec3 vColor;
out float vGlow;
// Temperature palette: hot (blue-white) -> cool (deep amber/red).
vec3 palette(float t){
  vec3 hot = vec3(0.75, 0.85, 1.0);
  vec3 mid = vec3(1.0, 0.85, 0.55);
  vec3 cool = vec3(0.9, 0.35, 0.25);
  return t > 0.5 ? mix(mid, hot, (t-0.5)*2.0) : mix(cool, mid, t*2.0);
}
void main(){
  gl_Position = uVP * vec4(aPos, 1.0);
  float d = clamp(aDensity, 0.0, 1.0);
  vColor = palette(uTemp) * (0.4 + 1.6*d) + vec3(0.15)*aSpeed*3.0;
  vGlow = 0.3 + d;
  float size = uPointScale * (1.0 + 2.5*d) / max(gl_Position.w, 0.15);
  gl_PointSize = clamp(size, 1.0, 32.0);
}`;

const PARTICLE_FS = `#version 300 es
precision highp float;
in vec3 vColor; in float vGlow;
out vec4 frag;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c,c);
  if (r > 1.0) discard;
  float a = exp(-r*3.0) * vGlow;
  frag = vec4(vColor * a, a);
}`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
out vec2 vUV;
void main(){ vec2 p=P[gl_VertexID]; vUV=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;

const BRIGHT_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uScene;
void main(){ vec3 c=texture(uScene,vUV).rgb; float l=dot(c,vec3(0.299,0.587,0.114));
  frag=vec4(c*smoothstep(0.6,1.1,l),1.0); }`;

const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uTex; uniform vec2 uDir;
void main(){ vec3 s=texture(uTex,vUV).rgb*0.227;
  for(int i=1;i<5;i++){ float o=float(i); vec2 d=uDir*o;
    float w=exp(-o*o*0.18);
    s+=texture(uTex,vUV+d).rgb*w*0.12; s+=texture(uTex,vUV-d).rgb*w*0.12; }
  frag=vec4(s,1.0); }`;

const COMPOSITE_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uScene; uniform sampler2D uBloom;
void main(){ vec3 c=texture(uScene,vUV).rgb + texture(uBloom,vUV).rgb*1.4;
  c = c/(c+vec3(1.0)); // Reinhard tonemap
  frag=vec4(pow(c, vec3(0.4545)), 1.0); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) || "shader error");
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) || "link error");
  return p;
}

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!ctx) throw new Error("WebGL2 unavailable");
  const gl: WebGL2RenderingContext = ctx; // non-null binding used by all closures below
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("float render targets unavailable");

  const particleProg = compile(gl, PARTICLE_VS, PARTICLE_FS);
  const brightProg = compile(gl, QUAD_VS, BRIGHT_FS);
  const blurProg = compile(gl, QUAD_VS, BLUR_FS);
  const compositeProg = compile(gl, QUAD_VS, COMPOSITE_FS);

  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  const emptyVao = gl.createVertexArray()!;
  let w = 1, h = 1;
  let scene = makeTarget(gl, 1, 1);
  let ping = makeTarget(gl, 1, 1);
  let pong = makeTarget(gl, 1, 1);

function resize(width: number, height: number, dpr: number) {
  const nextW = Math.max(1, Math.floor(width * dpr));
  const nextH = Math.max(1, Math.floor(height * dpr));

  if (nextW === w && nextH === h) {
    return;
  }

  w = nextW;
  h = nextH;

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

    // --- Particles into HDR scene target, additive ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.02, 0.025, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(particleProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(particleProg, "uVP"), false, vp);
    gl.uniform1f(gl.getUniformLocation(particleProg, "uTemp"), frame.temperature);
    gl.uniform1f(gl.getUniformLocation(particleProg, "uPointScale"), h * 0.03);

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, frame.buffer, gl.DYNAMIC_DRAW);
    const s = frame.stride * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, s, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, s, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, s, 16);
    gl.drawArrays(gl.POINTS, 0, frame.count);
    gl.disable(gl.BLEND);

    // --- Bright pass (half res) ---
    const hw = w >> 1, hh = h >> 1;
    gl.viewport(0, 0, hw, hh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ping.fbo);
    gl.useProgram(brightProg);
    bindTex(gl, brightProg, "uScene", scene.tex, 0);
    drawQuad();

    // --- Separable blur ping<->pong ---
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pong.fbo);
      gl.useProgram(blurProg);
      gl.uniform2f(gl.getUniformLocation(blurProg, "uDir"), 1 / hw, 0);
      bindTex(gl, blurProg, "uTex", ping.tex, 0);
      drawQuad();
      gl.bindFramebuffer(gl.FRAMEBUFFER, ping.fbo);
      gl.uniform2f(gl.getUniformLocation(blurProg, "uDir"), 0, 1 / hh);
      bindTex(gl, blurProg, "uTex", pong.tex, 0);
      drawQuad();
    }

    // --- Composite + tonemap to screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(compositeProg);
    bindTex(gl, compositeProg, "uScene", scene.tex, 0);
    bindTex(gl, compositeProg, "uBloom", ping.tex, 1);
    drawQuad();
  }

  function dispose() {
    [particleProg, brightProg, blurProg, compositeProg].forEach((p) => gl.deleteProgram(p));
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
    gl.deleteVertexArray(emptyVao);
    [scene, ping, pong].forEach((t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); });
  }

  return { backend: "webgl2", resize, render, dispose };
}

function bindTex(gl: WebGL2RenderingContext, prog: WebGLProgram, name: string, tex: WebGLTexture, unit: number) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(gl.getUniformLocation(prog, name), unit);
}
