import {
  CYCLE_SECONDS,
  createInitialState,
  DYNAMIC_STRIDE_FLOATS,
  PARTICLE_COUNT,
  phaseLabelAt,
  STATIC_STRIDE_FLOATS,
} from "./simulation";
import {
  RENDER_FRAGMENT,
  RENDER_VERTEX,
  SIM_FRAGMENT,
  SIM_VERTEX,
} from "./shaders";

interface RendererOptions {
  onProgress?: (normalizedTime: number, phaseLabel: string) => void;
  onError?: (message: string) => void;
}

const FLOAT_BYTES = 4;

export class BigBangRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private opts: RendererOptions;

  private simProgram: WebGLProgram;
  private renderProgram: WebGLProgram;

  // Ping-pong dynamic state buffers + shared static attribute buffer.
  private dynBuffers: [WebGLBuffer, WebGLBuffer];
  private staticBuffer: WebGLBuffer;
  private read = 0;

  // VAOs: sim reads all attributes; render reads position/velocity/seed.
  private simVAOs: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private renderVAOs: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private transformFeedback: WebGLTransformFeedback;

  // Uniform locations.
  private simU: { time: WebGLUniformLocation | null; dt: WebGLUniformLocation | null };
  private renderU: {
    time: WebGLUniformLocation | null;
    aspect: WebGLUniformLocation | null;
    pixelRatio: WebGLUniformLocation | null;
  };

  private raf = 0;
  private lastMs = 0;
  private simTime = 0; // normalized [0,1]
  private speed = 1;
  private running = false;
  private destroyed = false;
  private pixelRatio = 1;
  private lastPhase = "";
  private lastReportedTime = -1;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    this.opts = opts;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error("WebGL2 is not available in this browser.");
    }
    this.gl = gl;

    this.simProgram = this.buildProgram(SIM_VERTEX, SIM_FRAGMENT, [
      "v_position",
      "v_velocity",
    ]);
    this.renderProgram = this.buildProgram(RENDER_VERTEX, RENDER_FRAGMENT);

    this.simU = {
      time: gl.getUniformLocation(this.simProgram, "u_time"),
      dt: gl.getUniformLocation(this.simProgram, "u_dt"),
    };
    this.renderU = {
      time: gl.getUniformLocation(this.renderProgram, "u_time"),
      aspect: gl.getUniformLocation(this.renderProgram, "u_aspect"),
      pixelRatio: gl.getUniformLocation(this.renderProgram, "u_pixelRatio"),
    };

    // Allocate buffers + VAOs.
    const { dynamic, static: staticData } = createInitialState();

    this.staticBuffer = this.createBuffer(staticData, gl.STATIC_DRAW);
    this.dynBuffers = [
      this.createBuffer(dynamic, gl.DYNAMIC_COPY),
      this.createBuffer(
        new Float32Array(PARTICLE_COUNT * DYNAMIC_STRIDE_FLOATS),
        gl.DYNAMIC_COPY,
      ),
    ];

    this.simVAOs = [this.makeSimVAO(0), this.makeSimVAO(1)];
    this.renderVAOs = [this.makeRenderVAO(0), this.makeRenderVAO(1)];

    const tf = gl.createTransformFeedback();
    if (!tf) throw new Error("Failed to create transform feedback.");
    this.transformFeedback = tf;

    // Persistent GL state for additive luminous points.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied additive-ish
    gl.clearColor(0.02, 0.024, 0.04, 1.0);

    // Keep initial dynamic data for reset.
    this.initialDynamic = dynamic;
  }

  private initialDynamic: Float32Array;

  /* ---------- setup helpers ---------- */

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) throw new Error("Failed to create shader.");
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      // Diagnostics go to console; UI shows a friendly message.
      console.error("[bigbang] shader compile error:", log, "\n", src);
      throw new Error("Failed to compile a shader program.");
    }
    return sh;
  }

  private buildProgram(
    vsSrc: string,
    fsSrc: string,
    feedbackVaryings?: string[],
  ): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    if (!prog) throw new Error("Failed to create program.");
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    if (feedbackVaryings) {
      gl.transformFeedbackVaryings(prog, feedbackVaryings, gl.INTERLEAVED_ATTRIBS);
    }
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      console.error("[bigbang] program link error:", log);
      throw new Error("Failed to link a shader program.");
    }
    return prog;
  }

  private createBuffer(data: Float32Array, usage: number): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer();
    if (!buf) throw new Error("Failed to create buffer.");
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return buf;
  }

  private makeSimVAO(index: number): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO.");
    gl.bindVertexArray(vao);

    const dynStride = DYNAMIC_STRIDE_FLOATS * FLOAT_BYTES;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuffers[index]);
    // a_position (loc 0), a_velocity (loc 1)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, dynStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, dynStride, 3 * FLOAT_BYTES);

    const statStride = STATIC_STRIDE_FLOATS * FLOAT_BYTES;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuffer);
    // a_seed (loc 2), a_dir (loc 3)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, statStride, 0);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, statStride, 3 * FLOAT_BYTES);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vao;
  }

  private makeRenderVAO(index: number): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO.");
    gl.bindVertexArray(vao);

    const dynStride = DYNAMIC_STRIDE_FLOATS * FLOAT_BYTES;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuffers[index]);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, dynStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, dynStride, 3 * FLOAT_BYTES);

    const statStride = STATIC_STRIDE_FLOATS * FLOAT_BYTES;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, statStride, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vao;
  }

  /* ---------- public API ---------- */

  setSpeed(v: number): void {
    this.speed = Math.max(0, v);
  }

  resize(): void {
    if (this.destroyed) return;
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2);
    this.pixelRatio = dpr;

    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  start(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    this.lastMs = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  pause(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    // Keep the last frame visible.
    this.renderPass();
  }

  reset(): void {
    if (this.destroyed) return;
    const gl = this.gl;
    this.simTime = 0;
    this.read = 0;
    this.lastPhase = "";
    this.lastReportedTime = -1;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuffers[0]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.initialDynamic);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.renderPass();
    this.report(true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;

    const gl = this.gl;
    gl.deleteProgram(this.simProgram);
    gl.deleteProgram(this.renderProgram);
    gl.deleteBuffer(this.dynBuffers[0]);
    gl.deleteBuffer(this.dynBuffers[1]);
    gl.deleteBuffer(this.staticBuffer);
    gl.deleteVertexArray(this.simVAOs[0]);
    gl.deleteVertexArray(this.simVAOs[1]);
    gl.deleteVertexArray(this.renderVAOs[0]);
    gl.deleteVertexArray(this.renderVAOs[1]);
    gl.deleteTransformFeedback(this.transformFeedback);
  }

  /* ---------- frame loop ---------- */

  private loop = (nowMs: number): void => {
    if (this.destroyed || !this.running) return;

    if (this.lastMs === 0) this.lastMs = nowMs;
    let dtSec = (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    // Clamp to avoid huge jumps after a tab switch.
    dtSec = Math.min(dtSec, 0.05);

    const scaledDt = dtSec * this.speed;
    // Advance normalized time; loop the lifecycle.
    this.simTime += scaledDt / CYCLE_SECONDS;
    if (this.simTime >= 1) this.simTime = this.simTime % 1;

    this.updatePass(scaledDt);
    this.renderPass();
    this.report(false);

    this.raf = requestAnimationFrame(this.loop);
  };

  private updatePass(scaledDt: number): void {
    const gl = this.gl;
    const src = this.read;
    const dst = this.read ^ 1;

    gl.useProgram(this.simProgram);
    gl.uniform1f(this.simU.time, this.simTime);
    // GPU integrates using a stable per-frame dt (already speed-scaled).
    gl.uniform1f(this.simU.dt, Math.min(scaledDt, 0.05));

    gl.bindVertexArray(this.simVAOs[src]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.dynBuffers[dst]);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    this.read = dst;
  }

  private renderPass(): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);

    const w = this.canvas.width || 1;
    const h = this.canvas.height || 1;

    gl.useProgram(this.renderProgram);
    gl.uniform1f(this.renderU.time, this.simTime);
    gl.uniform1f(this.renderU.aspect, w / h);
    gl.uniform1f(this.renderU.pixelRatio, this.pixelRatio);

    gl.bindVertexArray(this.renderVAOs[this.read]);
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
    gl.bindVertexArray(null);
  }

  /** Report to React only when the phase changes or time moves noticeably. */
  private report(force: boolean): void {
    const phase = phaseLabelAt(this.simTime);
    const timeMoved = Math.abs(this.simTime - this.lastReportedTime) > 0.01;
    if (force || phase !== this.lastPhase || timeMoved) {
      this.lastPhase = phase;
      this.lastReportedTime = this.simTime;
      this.opts.onProgress?.(this.simTime, phase);
    }
  }
}
