/// <reference types="@webgpu/types" />
import type { Renderer, FrameData, Camera } from "./types";
import { viewProjection } from "./mat";


const PARTICLE_WGSL = /* wgsl */ `
struct Uniforms { vp: mat4x4<f32>, temp: f32, pointScale: f32, aspect: f32, _pad: f32 };
@group(0) @binding(0) var<uniform> U: Uniforms;

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) color: vec3<f32>,
               @location(1) uv: vec2<f32>, @location(2) glow: f32 };

fn palette(t: f32) -> vec3<f32> {
  let hot = vec3<f32>(0.75, 0.85, 1.0);
  let mid = vec3<f32>(1.0, 0.85, 0.55);
  let cool = vec3<f32>(0.9, 0.35, 0.25);
  if (t > 0.5) { return mix(mid, hot, (t - 0.5) * 2.0); }
  return mix(cool, mid, t * 2.0);
}

// 6 vertices per particle (billboard quad).
@vertex
fn vs(@location(0) center: vec3<f32>, @location(1) density: f32, @location(2) speed: f32,
      @builtin(vertex_index) vi: u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.),
    vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  let corner = corners[vi];
  var clip = U.vp * vec4<f32>(center, 1.0);
  let d = clamp(density, 0.0, 1.0);
  let size = U.pointScale * (1.0 + 2.5 * d) / max(clip.w, 0.15);
  clip = vec4<f32>(clip.xy + corner * vec2(size / U.aspect, size) * clip.w, clip.zw);
  var out: VSOut;
  out.pos = clip;
  out.color = palette(U.temp) * (0.4 + 1.6 * d) + vec3<f32>(0.15) * speed * 3.0;
  out.uv = corner;
  out.glow = 0.3 + d;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let r = dot(in.uv, in.uv);
  if (r > 1.0) { discard; }
  let a = exp(-r * 3.0) * in.glow;
  return vec4<f32>(in.color * a, a);
}`;

const POST_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloom: texture_2d<f32>;
struct Cfg { mode: u32, texel: vec2<f32>, _p: f32 };
@group(0) @binding(3) var<uniform> C: Cfg;

struct VO { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2<f32>,3>(vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  var o: VO; o.pos = vec4<f32>(p[i], 0., 1.); o.uv = p[i]*0.5+0.5; o.uv.y = 1.0 - o.uv.y;
  return o;
}

@fragment
fn bright(in: VO) -> @location(0) vec4<f32> {
  let c = textureSample(scene, samp, in.uv).rgb;
  let l = dot(c, vec3<f32>(0.299,0.587,0.114));
  return vec4<f32>(c * smoothstep(0.6,1.1,l), 1.0);
}

@fragment
fn blur(in: VO) -> @location(0) vec4<f32> {
  let dir = select(vec2<f32>(0.,C.texel.y), vec2<f32>(C.texel.x,0.), C.mode==0u);
  var s = textureSample(scene, samp, in.uv).rgb * 0.227;
  for (var i=1; i<5; i++){ let o=f32(i); let w=exp(-o*o*0.18)*0.12;
    s += textureSample(scene, samp, in.uv+dir*o).rgb*w;
    s += textureSample(scene, samp, in.uv-dir*o).rgb*w; }
  return vec4<f32>(s, 1.0);
}

@fragment
fn composite(in: VO) -> @location(0) vec4<f32> {
  var c = textureSample(scene, samp, in.uv).rgb + textureSample(bloom, samp, in.uv).rgb*1.4;
  c = c/(c+vec3<f32>(1.0));
  return vec4<f32>(pow(c, vec3<f32>(0.4545)), 1.0);
}`;

export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no WebGPU adapter");
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  const HDR: GPUTextureFormat = "rgba16float";
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  const uniformBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cfgBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const pMod = device.createShaderModule({ code: PARTICLE_WGSL });
  const postMod = device.createShaderModule({ code: POST_WGSL });

  const particlePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: pMod, entryPoint: "vs",
      buffers: [{
        arrayStride: 20, stepMode: "instance",
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32" },
          { shaderLocation: 2, offset: 16, format: "float32" },
        ],
      }],
    },
    fragment: {
      module: pMod, entryPoint: "fs",
      targets: [{
        format: HDR,
        blend: {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });

  const postPipeline = (entry: string, target: GPUTextureFormat) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: postMod, entryPoint: "vs" },
      fragment: { module: postMod, entryPoint: entry, targets: [{ format: target }] },
      primitive: { topology: "triangle-list" },
    });
  const brightPipe = postPipeline("bright", HDR);
  const blurPipe = postPipeline("blur", HDR);
  const compositePipe = postPipeline("composite", format);

  let w = 1, h = 1;
  let sceneTex!: GPUTexture, pingTex!: GPUTexture, pongTex!: GPUTexture;
  let instanceBuf: GPUBuffer | null = null;

  const uPBind = device.createBindGroup({
    layout: particlePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
  });

  function tex(width: number, height: number) {
    return device.createTexture({
      size: [Math.max(1, width), Math.max(1, height)],
      format: HDR,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

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

  sceneTex?.destroy();
  pingTex?.destroy();
  pongTex?.destroy();

  sceneTex = tex(w, h);
  pingTex = tex(Math.max(1, w >> 1), Math.max(1, h >> 1));
  pongTex = tex(Math.max(1, w >> 1), Math.max(1, h >> 1));
}

  function postBind(pipe: GPURenderPipeline, sceneView: GPUTextureView, bloomView: GPUTextureView) {
    return device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: sceneView },
        { binding: 2, resource: bloomView },
        { binding: 3, resource: { buffer: cfgBuf } },
      ],
    });
  }

  function render(frame: FrameData, cam: Camera) {
    const vp = viewProjection(cam, w / h);
    const u = new Float32Array(20);
    u.set(vp, 0);
    u[16] = frame.temperature;
    u[17] = h * 0.00006;      // pointScale (clip-space)
    u[18] = w / h;            // aspect
    device.queue.writeBuffer(uniformBuf, 0, u);

    const bytes = frame.count * frame.stride * 4;
    if (!instanceBuf || instanceBuf.size < bytes) {
      instanceBuf?.destroy();
      instanceBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    device.queue.writeBuffer(instanceBuf, 0, frame.buffer, 0, frame.count * frame.stride);

    const enc = device.createCommandEncoder();

    // Particles -> scene
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: sceneTex.createView(),
          clearValue: { r: 0.02, g: 0.025, b: 0.05, a: 1 },
          loadOp: "clear", storeOp: "store",
        }],
      });
      pass.setPipeline(particlePipeline);
      pass.setBindGroup(0, uPBind);
      pass.setVertexBuffer(0, instanceBuf);
      pass.draw(6, frame.count);
      pass.end();
    }

    const dummy = sceneTex.createView();
    // Bright pass -> ping
    runPost(enc, brightPipe, pingTex.createView(), postBind(brightPipe, sceneTex.createView(), dummy));

    // Blur ping<->pong (H then V), two iterations.
    const bwF = w >> 1, bhF = h >> 1;
    for (let i = 0; i < 2; i++) {
      // Horizontal: read ping -> write pong. mode = 1
      device.queue.writeBuffer(cfgBuf, 0, new Uint32Array([1]));
      device.queue.writeBuffer(cfgBuf, 8, new Float32Array([1 / bwF, 1 / bhF]));
      runPost(enc, blurPipe, pongTex.createView(), postBind(blurPipe, pingTex.createView(), dummy));
      // Vertical: read pong -> write ping. mode = 0
      device.queue.writeBuffer(cfgBuf, 0, new Uint32Array([0]));
      device.queue.writeBuffer(cfgBuf, 8, new Float32Array([1 / bwF, 1 / bhF]));
      runPost(enc, blurPipe, pingTex.createView(), postBind(blurPipe, pongTex.createView(), dummy));
    }

    // Composite scene + bloom(ping) -> swapchain
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear", storeOp: "store",
        }],
      });
      pass.setPipeline(compositePipe);
      pass.setBindGroup(0, postBind(compositePipe, sceneTex.createView(), pingTex.createView()));
      pass.draw(3);
      pass.end();
    }

    device.queue.submit([enc.finish()]);
  }

  function runPost(
    enc: GPUCommandEncoder,
    pipe: GPURenderPipeline,
    target: GPUTextureView,
    bind: GPUBindGroup,
  ) {
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }

  function dispose() {
    sceneTex?.destroy();
    pingTex?.destroy();
    pongTex?.destroy();
    instanceBuf?.destroy();
    uniformBuf.destroy();
    cfgBuf.destroy();
    device.destroy();
  }

  return { backend: "webgpu", resize, render, dispose };
}
