// Loads the committed pkg/ glue and points it at the statically-served .wasm.
// Keeping the URL explicit means NO Next.js config change is required — the
// only shell edit remains the single manifest entry (CONTEXT.md non-negotiable).

import init, { Simulation, get_memory } from "../wasm/pkg/bigbang_rust.js";

let ready: Promise<void> | null = null;

export async function loadEngine(): Promise<void> {
  if (!ready) {
    ready = init(new URL("/bigbang_rust/bigbang_rust_bg.wasm", window.location.origin)).then(
      () => undefined,
    );
  }
  return ready;
}

export interface EngineHandle {
  sim: Simulation;
  /** Fresh Float32Array view over the current render buffer (re-created after
   *  each step because WASM memory can grow and detach old views). */
  view(): Float32Array;
}

export function createSimulation(preset: number, seed: number): EngineHandle {
  const sim = new Simulation(preset, seed);
  return {
    sim,
    view() {
      const ptr = sim.render_ptr();
      const len = sim.render_len();
      return new Float32Array(get_memory().buffer, ptr, len);
    },
  };
}

export { Simulation };
