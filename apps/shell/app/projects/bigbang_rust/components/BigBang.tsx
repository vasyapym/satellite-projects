"use client";

import { useRef } from "react";
import { useSimulation } from "../engine/useSimulation";
import { ControlPanel } from "./ControlPanel";

export function BigBang() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useSimulation(canvasRef, stageRef);

  return (
    <div className="bb-root">
      <div ref={stageRef} className="bb-stage">
        <canvas ref={canvasRef} className="bb-canvas" />

        {sim.error && (
          <div className="bb-error">
            <strong>Renderer unavailable.</strong>
            <p>{sim.error}</p>
            <p className="bb-muted">
              This satellite needs WebGPU or WebGL2 with float render targets.
            </p>
          </div>
        )}

        <div className="bb-caption">
          <span className="bb-dot" /> Rust · WebAssembly · Barnes–Hut N-body
        </div>
      </div>

      <ControlPanel
        telemetry={sim.telemetry}
        controls={sim.controls}
        onTimeScale={sim.setTimeScale}
        onRunning={sim.setRunning}
        onPreset={sim.setPreset}
        onReset={sim.reset}
        onParams={sim.setParams}
      />

      <style jsx>{`
        .bb-root {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
          overflow: hidden;
        }

        .bb-stage {
          position: relative;
          width: min(100%, 100vmin);
          max-width: 100%;
          min-width: 0;
          aspect-ratio: 1 / 1;
          overflow: hidden;
          box-sizing: border-box;
        }

        .bb-canvas {
          position: absolute;
          inset: 0;
          display: block;
          width: 100%;
          height: 100%;
          max-width: 100%;
          max-height: 100%;
          min-width: 0;
          min-height: 0;
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
}