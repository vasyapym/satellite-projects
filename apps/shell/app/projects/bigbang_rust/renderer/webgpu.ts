/// <reference types="@webgpu/types" />
import type { Renderer, FrameData, Camera } from "./types";
import { viewProjection } from "./mat";
import { VISUAL, wgslConstants } from "./visuals";

const WC = wgslConstants();

const PARTICLE_WGSL = /* wgsl */ `${WC}
struct Camera {
  viewProj : mat4x4<f32>,
  temp     : f32,
  phaseF   : f32,
  viewport : vec2<f32>,
  dpr      : f32,
  _pad     : f32,
};

@group(0) @binding(0) var<uniform> C : Camera;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
  @location(1) density   : f32,
  @location(2) heat      : f32,
};

fn palette(x : f32) -> vec3<f32> {
  if (x > 0.5) {
    return mix(COL_MID, COL_HOT, (x - 0.5) * 2.0);
  }

  return mix(COL_COOL, COL_MID, x * 2.0);
}

@vertex
fn vs_main(
  @location(0) inst : vec3<f32>,
  @location(1) density : f32,
  @location(2) speed : f32,
  @builtin(vertex_index) vi : u32,
) -> VSOut {
  var corners = array<vec2<f32>,6>(
    vec2<f32>(-1.,-1.), vec2<f32>(1.,-1.), vec2<f32>(-1.,1.),
    vec2<f32>(-1.,1.), vec2<f32>(1.,-1.), vec2<f32>(1.,1.)
  );

  let corner = corners[vi];
  let clip = C.viewProj * vec4<f32>(inst, 1.0);
  let speedN = clamp(speed * SPEED_REF, 0.0, 1.0);

  var out : VSOut;

  out.heat = clamp(
    C.temp * (HEAT_BASE + HEAT_DENS * density)
      + HEAT_SPEED * speedN,
    0.0,
    1.0,
  );

  out.density = density;

  var sizePx =
    SIZE_BASE * (SIZE_FLOOR + SIZE_DENS * density);

  sizePx =
    clamp(sizePx, SIZE_MIN_PX, SIZE_MAX_PX) * C.dpr;

  // Pixel-sized billboard:
  // convert pixel half-extent to clip-space and multiply by clip.w so the
  // offset remains constant in screen pixels after perspective division.
  let offset =
    corner * sizePx / C.viewport * clip.w;

  out.pos = vec4<f32>(
    clip.xy + offset,
    clip.z,
    clip.w,
  );

  out.uv = corner;

  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let r = length(in.uv);
  let core = exp(-r * r * FALLOFF_CORE);
  let glow = exp(-r * r * FALLOFF_GLOW) * GLOW_WEIGHT;

  let mask =
    (core + glow)
      * (1.0 - smoothstep(1.0 - EDGE_SOFT, 1.0, r));

  if (mask <= 0.0) {
    discard;
  }

  var col = palette(in.heat);

  let sat = mix(SAT_MIN, SAT_MAX, C.phaseF);
  let luma = dot(
    col,
    vec3<f32>(0.299, 0.587, 0.114),
  );

  col = mix(
    vec3<f32>(luma),
    col,
    sat,
  );

  let bright = BASE_INTENSITY
    * (DENS_FLOOR + DENS_GAIN * in.density)
    * (TEMP_FLOOR + TEMP_GAIN * in.heat);

  return vec4(
    col * bright * mask,
    mask,
  );
}`;

const POST_WGSL = /* wgsl */ `${WC}
struct Post {
  texel  : vec2<f32>,
  mode   : u32,
  phaseF : f32,
};

@group(0) @binding(0) var<uniform> C : Post;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex0 : texture_2d<f32>;
@group(0) @binding(3) var tex1 : texture_2d<f32>;

struct VOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VOut {
  var p = array<vec2<f32>,3>(
    vec2<f32>(-1.,-1.),
    vec2<f32>(3.,-1.),
    vec2<f32>(-1.,3.)
  );

  let q = p[vi];

  var o : VOut;
  o.pos = vec4<f32>(q, 0.0, 1.0);
  o.uv = q * 0.5 + 0.5;

  return o;
}

@fragment
fn fs_bright(in : VOut) -> @location(0) vec4<f32> {
  let c = textureSample(
    tex0,
    samp,
    in.uv,
  ).rgb;

  let luma = dot(
    c,
    vec3<f32>(0.299, 0.587, 0.114),
  );

  let k = smoothstep(
    BLOOM_THRESHOLD - BLOOM_KNEE,
    BLOOM_THRESHOLD + BLOOM_KNEE,
    luma,
  );

  return vec4(c * k, 1.0);
}

@fragment
fn fs_blur(in : VOut) -> @location(0) vec4<f32> {
  let dir = select(
    vec2<f32>(0., C.texel.y),
    vec2<f32>(C.texel.x, 0.),
    C.mode == 0u
  );

  var sum =
    textureSample(tex0, samp, in.uv).rgb * 0.2;

  for (var i = 1; i < 5; i++) {
    let o = f32(i);
    let w = exp(-o * o * 0.18) * 0.12;
    let d = dir * o;

    sum +=
      textureSample(tex0, samp, in.uv + d).rgb * w;

    sum +=
      textureSample(tex0, samp, in.uv - d).rgb * w;
  }

  return vec4(sum, 1.0);
}

fn aces(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;

  return clamp(
    (x * (a * x + b)) /
      (x * (c * x + d) + e),
    vec3<f32>(0.0),
    vec3<f32>(1.0)
  );
}

@fragment
fn fs_composite(in : VOut) -> @location(0) vec4<f32> {
  let scene =
    textureSample(tex0, samp, in.uv).rgb;

  let bloom =
    textureSample(tex1, samp, in.uv).rgb;

  let bg =
    mix(BG_BOT, BG_TOP, in.uv.y);

  let dist =
    distance(in.uv, vec2<f32>(0.5));

  let vig =
    1.0 - BG_VIGNETTE
      * smoothstep(0.2, 0.9, dist);

  let bloomPhase =
    mix(BLOOM_PHASE_HI, BLOOM_PHASE_LO, C.phaseF);

  var col =
    bg * vig
      + scene
      + bloom * (BLOOM_INTENSITY * bloomPhase);

  col *= EXPOSURE;
  col = aces(col);
  col = pow(
    col,
    vec3<f32>(1.0 / GAMMA),
  );

  return vec4(col, 1.0);
}`;

export async function createWebGPURenderer(
  canvas: HTMLCanvasElement,
): Promise<Renderer> {
  const adapter = await navigator.gpu.requestAdapter();

  if (!adapter) {
    throw new Error("no WebGPU adapter");
  }

  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();

  ctx.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  const HDR: GPUTextureFormat = "rgba16float";

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  // Camera:
  // mat4 (64) + temp/phaseF (8) + viewport (8) + dpr/pad (8) = 88 bytes.
  const uniformBuf = device.createBuffer({
    size: 88,
    usage:
      GPUBufferUsage.UNIFORM |
      GPUBufferUsage.COPY_DST,
  });

  // Post:
  // vec2 texel (8) + mode (4) + phaseF (4) = 16 bytes.
  const brightCfgBuf = device.createBuffer({
    size: 16,
    usage:
      GPUBufferUsage.UNIFORM |
      GPUBufferUsage.COPY_DST,
  });

  const blurHCfgBuf = device.createBuffer({
    size: 16,
    usage:
      GPUBufferUsage.UNIFORM |
      GPUBufferUsage.COPY_DST,
  });

  const blurVCfgBuf = device.createBuffer({
    size: 16,
    usage:
      GPUBufferUsage.UNIFORM |
      GPUBufferUsage.COPY_DST,
  });

  const compositeCfgBuf = device.createBuffer({
    size: 16,
    usage:
      GPUBufferUsage.UNIFORM |
      GPUBufferUsage.COPY_DST,
  });

  const pMod = device.createShaderModule({
    code: PARTICLE_WGSL,
  });

  const postMod = device.createShaderModule({
    code: POST_WGSL,
  });

  const particlePipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
      module: pMod,
      entryPoint: "vs_main",

      buffers: [{
        arrayStride: 20,
        stepMode: "instance",
        attributes: [
          {
            shaderLocation: 0,
            offset: 0,
            format: "float32x3",
          },
          {
            shaderLocation: 1,
            offset: 12,
            format: "float32",
          },
          {
            shaderLocation: 2,
            offset: 16,
            format: "float32",
          },
        ],
      }],
    },

    fragment: {
      module: pMod,
      entryPoint: "fs_main",

      targets: [{
        format: HDR,

        blend: {
          color: {
            srcFactor: "one",
            dstFactor: "one",
            operation: "add",
          },

          alpha: {
            srcFactor: "one",
            dstFactor: "one",
            operation: "add",
          },
        },
      }],
    },

    primitive: {
      topology: "triangle-list",
    },
  });

  const postPipeline = (
    entry: string,
    target: GPUTextureFormat,
  ) =>
    device.createRenderPipeline({
      layout: "auto",

      vertex: {
        module: postMod,
        entryPoint: "vs_main",
      },

      fragment: {
        module: postMod,
        entryPoint: entry,
        targets: [{ format: target }],
      },

      primitive: {
        topology: "triangle-list",
      },
    });

  const brightPipe =
    postPipeline("fs_bright", HDR);

  const blurPipe =
    postPipeline("fs_blur", HDR);

  const compositePipe =
    postPipeline("fs_composite", format);

  let w = 1;
  let h = 1;

  let sceneTex!: GPUTexture;
  let pingTex!: GPUTexture;
  let pongTex!: GPUTexture;

  let instanceBuf: GPUBuffer | null = null;

  const uPBind = device.createBindGroup({
    layout: particlePipeline.getBindGroupLayout(0),

    entries: [{
      binding: 0,
      resource: {
        buffer: uniformBuf,
      },
    }],
  });

  function tex(width: number, height: number) {
    return device.createTexture({
      size: [
        Math.max(1, width),
        Math.max(1, height),
      ],

      format: HDR,

      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  function resize(
    width: number,
    height: number,
    dpr: number,
  ) {
    const nextW =
      Math.max(1, Math.floor(width * dpr));

    const nextH =
      Math.max(1, Math.floor(height * dpr));

    if (nextW === w && nextH === h) {
      return;
    }

    w = nextW;
    h = nextH;

    if (canvas.width !== w) {
      canvas.width = w;
    }

    if (canvas.height !== h) {
      canvas.height = h;
    }

    sceneTex?.destroy();
    pingTex?.destroy();
    pongTex?.destroy();

    sceneTex = tex(w, h);
    pingTex = tex(
      Math.max(1, w >> 1),
      Math.max(1, h >> 1),
    );
    pongTex = tex(
      Math.max(1, w >> 1),
      Math.max(1, h >> 1),
    );
  }

  function postBind(
    pipe: GPURenderPipeline,
    cfg: GPUBuffer,
    tex0View: GPUTextureView,
    tex1View: GPUTextureView,
  ) {
    return device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),

      entries: [
        {
          binding: 0,
          resource: {
            buffer: cfg,
          },
        },
        {
          binding: 1,
          resource: sampler,
        },
        {
          binding: 2,
          resource: tex0View,
        },
        {
          binding: 3,
          resource: tex1View,
        },
      ],
    });
  }

  function writePostUniform(
    target: GPUBuffer,
    texelX: number,
    texelY: number,
    mode: number,
    phaseF: number,
  ) {
    const cfg = new ArrayBuffer(16);
    const f32 = new Float32Array(cfg);
    const u32 = new Uint32Array(cfg);

    f32[0] = texelX;
    f32[1] = texelY;
    u32[2] = mode;
    f32[3] = phaseF;

    device.queue.writeBuffer(
      target,
      0,
      cfg,
    );
  }

  function render(
    frame: FrameData,
    cam: Camera,
  ) {
    const vp =
      viewProjection(cam, w / h);

    const dpr =
      Math.max(
        1,
        w / Math.max(1, canvas.clientWidth),
      );

    const u = new Float32Array(22);

    u.set(vp, 0);

    u[16] = frame.temperature;
    u[17] = frame.phase / 3.0;
    u[18] = w;
    u[19] = h;
    u[20] = dpr;
    u[21] = 0;

    device.queue.writeBuffer(
      uniformBuf,
      0,
      u,
    );

    const particleBytes =
      frame.count
      * frame.stride
      * Float32Array.BYTES_PER_ELEMENT;

    if (
      !instanceBuf ||
      instanceBuf.size < Math.max(20, particleBytes)
    ) {
      instanceBuf?.destroy();

      instanceBuf = device.createBuffer({
        size: Math.max(20, particleBytes),

        usage:
          GPUBufferUsage.VERTEX |
          GPUBufferUsage.COPY_DST,
      });
    }

    // GPUQueue.writeBuffer uses byte counts for dataSize.
    // frame.count * frame.stride is a float count, so convert it to bytes.
    device.queue.writeBuffer(
      instanceBuf,
      0,
      frame.buffer,
      0,
      particleBytes,
    );

    const enc =
      device.createCommandEncoder();

    // Particles -> scene.
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: sceneTex.createView(),
          clearValue: {
            r: 0,
            g: 0,
            b: 0,
            a: 1,
          },
          loadOp: "clear",
          storeOp: "store",
        }],
      });

      pass.setPipeline(
        particlePipeline,
      );

      pass.setBindGroup(
        0,
        uPBind,
      );

      pass.setVertexBuffer(
        0,
        instanceBuf,
      );

      // 6 vertices = 2 triangles per particle.
      pass.draw(
        6,
        frame.count,
      );

      pass.end();
    }

    const dummy =
      sceneTex.createView();

    const bwF =
      Math.max(1, w >> 1);

    const bhF =
      Math.max(1, h >> 1);

    const phaseF =
      frame.phase / 3.0;

    // Bright pass -> ping.
    writePostUniform(
      brightCfgBuf,
      1 / bwF,
      1 / bhF,
      0,
      phaseF,
    );

    runPost(
      enc,
      brightPipe,
      pingTex.createView(),
      postBind(
        brightPipe,
        brightCfgBuf,
        sceneTex.createView(),
        dummy,
      ),
    );

    // Blur ping<->pong:
    // mode 0 = horizontal, mode 1 = vertical.
    writePostUniform(
      blurHCfgBuf,
      1 / bwF,
      1 / bhF,
      0,
      phaseF,
    );

    writePostUniform(
      blurVCfgBuf,
      1 / bwF,
      1 / bhF,
      1,
      phaseF,
    );

    for (let i = 0; i < 2; i++) {
      runPost(
        enc,
        blurPipe,
        pongTex.createView(),
        postBind(
          blurPipe,
          blurHCfgBuf,
          pingTex.createView(),
          dummy,
        ),
      );

      runPost(
        enc,
        blurPipe,
        pingTex.createView(),
        postBind(
          blurPipe,
          blurVCfgBuf,
          pongTex.createView(),
          dummy,
        ),
      );
    }

    // Composite scene + bloom(ping) -> swapchain.
    writePostUniform(
      compositeCfgBuf,
      1 / bwF,
      1 / bhF,
      0,
      phaseF,
    );

    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view:
            ctx.getCurrentTexture()
              .createView(),

          clearValue: {
            r: 0,
            g: 0,
            b: 0,
            a: 1,
          },

          loadOp: "clear",
          storeOp: "store",
        }],
      });

      pass.setPipeline(
        compositePipe,
      );

      pass.setBindGroup(
        0,
        postBind(
          compositePipe,
          compositeCfgBuf,
          sceneTex.createView(),
          pingTex.createView(),
        ),
      );

      pass.draw(3);
      pass.end();
    }

    device.queue.submit([
      enc.finish(),
    ]);
  }

  function runPost(
    enc: GPUCommandEncoder,
    pipe: GPURenderPipeline,
    target: GPUTextureView,
    bind: GPUBindGroup,
  ) {
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: target,
        clearValue: {
          r: 0,
          g: 0,
          b: 0,
          a: 1,
        },
        loadOp: "clear",
        storeOp: "store",
      }],
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
    brightCfgBuf.destroy();
    blurHCfgBuf.destroy();
    blurVCfgBuf.destroy();
    compositeCfgBuf.destroy();

    device.destroy();
  }

  return {
    backend: "webgpu",
    resize,
    render,
    dispose,
  };
}