"use client";

import { useEffect, useRef, useState } from "react";
import { loadEngine, createSimulation, type EngineHandle } from "./wasm";
import { createRenderer, type Renderer } from "../renderer/types";
import { createCameraControls } from "./cameraControls";

export interface Telemetry {
  a: number;
  hubble: number;
  temperature: number;
  time: number;
  phase: number;
  dominant: number;
  count: number;
  backend: string;
  fps: number;
}

export interface SimControls {
  timeScale: number;
  running: boolean;
  preset: number;
  omegaM: number;
  omegaLambda: number;
  omegaR: number;
  h0: number;
}

const PHASE_NAMES = [
  "Inflation",
  "Rapid expansion",
  "Cooling",
  "Structure formation",
];

export const phaseName = (p: number) => PHASE_NAMES[p] ?? "—";

const DOMINANT_NAMES = ["Radiation", "Matter", "Dark energy"];

export const dominantName = (d: number) => DOMINANT_NAMES[d] ?? "—";

/**
 * Keep the GPU backing store bounded even if an upstream layout bug temporarily
 * produces an absurd CSS size.
 *
 * This is a safety limit on rendered pixels, not on the CSS size of the stage.
 */
const MAX_RENDER_DIMENSION = 4096;
const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * Keep each WASM call within the integrator's bounded 64-substep budget.
 *
 * MAX_SUBSTEP in the Rust engine is 2e-3, so 64 substeps = 0.128 simulation
 * time units per frame at most. The WASM side enforces the same ceiling.
 */
const MAX_SIM_DT = 0.128;

export function useSimulation(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stageRef: React.RefObject<HTMLDivElement | null>,
) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const controls = useRef<SimControls>({
    timeScale: 0.05,
    running: true,
    preset: 1,
    omegaM: 0.315,
    omegaLambda: 0.685,
    omegaR: 9e-5,
    h0: 1.0,
  });

  // Imperative command channel so UI changes do not re-init the loop.
  const commands = useRef<{
    reset?: number;
    resolution?: number;
    params?: boolean;
  }>({});

  useEffect(() => {
    let raf = 0;
    let disposed = false;

    let renderer: Renderer | null = null;
    let engine: EngineHandle | null = null;
    let controlsObj: ReturnType<typeof createCameraControls> | null = null;

    let cleanup = () => {};

    (async () => {
      const canvas = canvasRef.current;
      const stage = stageRef.current;

      if (!canvas || !stage) return;

      try {
        await loadEngine();

        if (disposed) return;

        engine = createSimulation(controls.current.preset, 1);

        renderer = await createRenderer(canvas);

        if (disposed) {
          engine.sim.free();
          engine = null;
          renderer.dispose();
          renderer = null;
          return;
        }

        controlsObj = createCameraControls(canvas);

        /**
         * Resize the renderer from the CONTAINER, never from the canvas.
         *
         * This breaks the feedback loop:
         *
         *   stage size -> renderer backing size
         *
         * instead of:
         *
         *   canvas size -> renderer backing size -> canvas size -> ...
         */
        let lastCssWidth = 0;
        let lastCssHeight = 0;
        let lastDpr = 0;

        const resizeRenderer = () => {
          if (disposed || !renderer) return;

          const rect = stage.getBoundingClientRect();

          const cssWidth = Math.max(0, Math.floor(rect.width));
          const cssHeight = Math.max(0, Math.floor(rect.height));

          // Hidden/collapsed containers have no useful rendering surface.
          if (cssWidth === 0 || cssHeight === 0) return;

          let dpr = Math.min(
            window.devicePixelRatio || 1,
            MAX_DEVICE_PIXEL_RATIO,
          );

          /**
           * Bound the actual backing-store dimensions. If the CSS container
           * ever becomes unexpectedly enormous, lower DPR rather than asking
           * WebGL/WebGPU for a giant allocation.
           */
          const largestCssDimension = Math.max(cssWidth, cssHeight);

          if (largestCssDimension * dpr > MAX_RENDER_DIMENSION) {
            dpr = MAX_RENDER_DIMENSION / largestCssDimension;
          }

          /**
           * Do not continuously call renderer.resize() with the same values.
           * This is important because resize() mutates canvas.width/height.
           */
          const sameSize =
            cssWidth === lastCssWidth &&
            cssHeight === lastCssHeight &&
            Math.abs(dpr - lastDpr) < 1e-6;

          if (sameSize) return;

          lastCssWidth = cssWidth;
          lastCssHeight = cssHeight;
          lastDpr = dpr;

          if (process.env.NODE_ENV !== "production") {
            console.debug("[bigbang] renderer resize", {
              cssWidth,
              cssHeight,
              dpr,
              backingWidth: Math.max(1, Math.floor(cssWidth * dpr)),
              backingHeight: Math.max(1, Math.floor(cssHeight * dpr)),
            });
          }

          renderer.resize(cssWidth, cssHeight, dpr);
        };

        const ro = new ResizeObserver(() => {
          resizeRenderer();
        });

        /**
         * Observe the stage/container, not the canvas.
         *
         * renderer.resize() is allowed to change canvas.width/height without
         * that becoming another resize observation.
         */
        ro.observe(stage);

        // Establish the initial renderer size immediately.
        resizeRenderer();

        let last = performance.now();
        let fpsAccum = 0;
        let fpsFrames = 0;
        let fps = 0;
        let invalidDtWarned = false;

        const loop = (now: number) => {
          if (disposed || !engine || !renderer || !controlsObj) return;

          const dt = Math.min((now - last) / 1000, 0.05);
          last = now;

          // Drain command channel.
          const c = commands.current;

          if (c.resolution !== undefined) {
            engine.sim.set_resolution(c.resolution);
            c.resolution = undefined;
          }

          if (c.reset !== undefined) {
            engine.sim.reset(c.reset);
            c.reset = undefined;
          }

          if (c.params) {
            const s = controls.current;

            engine.sim.set_params(
              s.omegaR,
              s.omegaM,
              0,
              s.omegaLambda,
              s.h0,
            );

            c.params = false;
          }

          const s = controls.current;

          if (s.running) {
            const dtSim = dt * s.timeScale;

            /**
             * Never cross the WASM boundary with NaN, Infinity, or a negative
             * delta. A malformed numeric control value used to make the Rust
             * integrator write NaNs into particle state, after which the
             * Barnes-Hut tree could recurse indefinitely and abort the WASM
             * instance as an "unreachable" trap.
             *
             * Also cap the per-frame simulation advance to the WASM engine's
             * bounded 64-substep budget rather than relying on Rust to discard
             * time after the fact.
             */
            if (Number.isFinite(dtSim) && dtSim > 0) {
              engine.sim.step(Math.min(dtSim, MAX_SIM_DT));
              invalidDtWarned = false;
            } else if (!invalidDtWarned) {
              invalidDtWarned = true;
              if (process.env.NODE_ENV !== "production") {
                console.warn("[bigbang] skipped invalid simulation dt", {
                  dt,
                  timeScale: s.timeScale,
                  dtSim,
                });
              }
            }
          }

          controlsObj.tick(dt);

          renderer.render(
            {
              buffer: engine.view(),
              count: engine.sim.particle_count(),
              stride: engine.sim.stride(),
              temperature: engine.sim.temperature(),
              phase: engine.sim.phase(),
            },
            controlsObj.camera,
          );

          fpsAccum += dt;
          fpsFrames++;

          if (fpsAccum >= 0.5) {
            fps = fpsFrames / fpsAccum;
            fpsAccum = 0;
            fpsFrames = 0;
          }

          setTelemetry({
            a: engine.sim.scale_factor(),
            hubble: engine.sim.hubble(),
            temperature: engine.sim.temperature(),
            time: engine.sim.sim_time(),
            phase: engine.sim.phase(),
            dominant: engine.sim.dominant(),
            count: engine.sim.particle_count(),
            backend: renderer.backend,
            fps,
          });

          raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);

        cleanup = () => {
          ro.disconnect();
        };
      } catch (e) {
        console.error(e);

        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      disposed = true;

      cancelAnimationFrame(raf);
      cleanup();

      controlsObj?.dispose();
      controlsObj = null;

      renderer?.dispose();
      renderer = null;

      engine?.sim.free();
      engine = null;
    };
  }, [canvasRef, stageRef]);

  return {
    telemetry,
    error,
    controls,

    setTimeScale: (v: number) => {
      // Keep invalid UI values out of the mutable command state. The render
      // loop still validates the derived dt immediately before the WASM call.
      controls.current.timeScale = Number.isFinite(v) ? Math.max(0, v) : 0;
    },

    setRunning: (v: boolean) => {
      controls.current.running = v;
    },

    setPreset: (p: number) => {
      controls.current.preset = p;
      commands.current.resolution = p;
    },

    reset: (seed = Math.floor(Math.random() * 1e9)) => {
      commands.current.reset = seed;
    },

    setParams: (partial: Partial<SimControls>) => {
      Object.assign(controls.current, partial);
      commands.current.params = true;
    },
  };
}