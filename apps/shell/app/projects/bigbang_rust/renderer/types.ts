// The tiny renderer seam. The app does not know which backend is active.

export interface FrameData {
  /** Interleaved Float32Array view over WASM memory: [x,y,z,density,speed] * N. */
  buffer: Float32Array;
  count: number;
  stride: number;
  /** Normalized global temperature proxy [0,1]. */
  temperature: number;
  /** 0 inflation, 1 radiation, 2 cooling, 3 structure. */
  phase: number;
}

export interface Camera {
  /** azimuth (rad), elevation (rad), distance. */
  azimuth: number;
  elevation: number;
  distance: number;
}

export interface Renderer {
  readonly backend: "webgpu" | "webgl2";
  resize(width: number, height: number, dpr: number): void;
  render(frame: FrameData, camera: Camera): void;
  dispose(): void;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  // WebGPU primary, WebGL2 fallback (graceful degradation).
  if ("gpu" in navigator) {
    try {
      const { createWebGPURenderer } = await import("./webgpu");
      return await createWebGPURenderer(canvas);
    } catch (e) {
      console.warn("[bigbang] WebGPU init failed, falling back to WebGL2:", e);
    }
  }

  const { createWebGL2Renderer } = await import("./webgl2");
  return createWebGL2Renderer(canvas);
}