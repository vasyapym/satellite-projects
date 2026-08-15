"use client";

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./bigbang.module.css";
import { BigBangRenderer } from "./renderer";

export function BigBang() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<BigBangRenderer | null>(null);

  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState("Singularity");
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    let renderer: BigBangRenderer;
    try {
      renderer = new BigBangRenderer(canvas, {
        onProgress: (t, ph) => {
          setProgress(t);
          setPhase(ph);
        },
        onError: (msg) => setError(msg),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the simulation.");
      return;
    }

    rendererRef.current = renderer;
    renderer.resize();

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      renderer.pause();
      setRunning(false);
    } else {
      renderer.start();
      setRunning(true);
    }

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(frame);

    return () => {
      ro.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    setRunning((prev) => {
      if (prev) r.pause();
      else r.start();
      return !prev;
    });
  }, []);

  const restart = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.reset();
    setProgress(0);
    setPhase("Singularity");
    r.start();
    setRunning(true);
  }, []);

  const onSpeed = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setSpeed(v);
    rendererRef.current?.setSpeed(v);
  }, []);

  return (
    <div>
      <div className={styles.frame} ref={frameRef}>
        {error ? (
          <div className={styles.error}>
            <p>
              {error} This visualization requires a browser with WebGL2 support.
            </p>
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className={styles.canvas} />
            <div className={styles.overlay}>
              <div className={styles.phase}>{phase}</div>
            </div>
          </>
        )}
      </div>

      {!error && (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.button}
            onClick={toggle}
            aria-pressed={running}
          >
            {running ? "Pause" : "Play"}
          </button>
          <button type="button" className={styles.button} onClick={restart}>
            Restart
          </button>
          <label className={styles.speed}>
            Speed
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.25}
              value={speed}
              onChange={onSpeed}
              aria-label="Simulation speed"
            />
            {speed.toFixed(2)}×
          </label>
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Simulation progress"
          >
            <div
              className={styles.progressBar}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
