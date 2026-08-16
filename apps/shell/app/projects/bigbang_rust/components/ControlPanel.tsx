"use client";
import { type Telemetry, type SimControls, phaseName, dominantName } from "../engine/useSimulation";

interface Props {
  telemetry: Telemetry | null;
  controls: React.MutableRefObject<SimControls>;
  onTimeScale: (v: number) => void;
  onRunning: (v: boolean) => void;
  onPreset: (p: number) => void;
  onReset: () => void;
  onParams: (p: Partial<SimControls>) => void;
}

const PRESET_LABELS = ["Low · 2K", "Medium · 8K", "High · 32K"];

export function ControlPanel(props: Props) {
  const { telemetry: t, controls } = props;
  const c = controls.current;

  return (
    <aside className="bb-panel">
      <section className="bb-group">
        <h2 className="bb-h">Simulation</h2>
        <div className="bb-row">
          <button className="bb-btn" onClick={() => props.onRunning(!c.running)}>
            {c.running ? "Pause" : "Play"}
          </button>
          <button className="bb-btn bb-btn--ghost" onClick={props.onReset}>New seed</button>
        </div>

        <label className="bb-label">
          Time scale
          <input type="range" min={0.005} max={0.3} step={0.005}
            defaultValue={c.timeScale}
            onChange={(e) => props.onTimeScale(parseFloat(e.target.value))} />
        </label>

        <label className="bb-label">
          Particles
          <div className="bb-seg">
            {PRESET_LABELS.map((label, i) => (
              <button key={i}
                className={"bb-seg-btn" + (c.preset === i ? " is-active" : "")}
                onClick={() => props.onPreset(i)}>{label}</button>
            ))}
          </div>
        </label>
      </section>

      <section className="bb-group">
        <h2 className="bb-h">Cosmology</h2>
        <Slider label="Ωm (matter)" min={0} max={1} step={0.005} value={c.omegaM}
          onChange={(v) => props.onParams({ omegaM: v })} />
        <Slider label="ΩΛ (dark energy)" min={0} max={1} step={0.005} value={c.omegaLambda}
          onChange={(v) => props.onParams({ omegaLambda: v })} />
        <Slider label="Ωr (radiation)" min={0} max={0.01} step={0.0001} value={c.omegaR}
          onChange={(v) => props.onParams({ omegaR: v })} />
        <Slider label="H₀ (expansion)" min={0.2} max={2.5} step={0.05} value={c.h0}
          onChange={(v) => props.onParams({ h0: v })} />
      </section>

      <section className="bb-group">
        <h2 className="bb-h">Telemetry</h2>
        <dl className="bb-tel">
          <Metric k="Phase" v={t ? phaseName(t.phase) : "—"} />
          <Metric k="Dominant" v={t ? dominantName(t.dominant) : "—"} />
          <Metric k="Scale a(t)" v={t ? t.a.toExponential(2) : "—"} />
          <Metric k="Hubble H" v={t ? t.hubble.toFixed(3) : "—"} />
          <Metric k="Temp (norm)" v={t ? t.temperature.toFixed(3) : "—"} />
          <Metric k="Sim time" v={t ? t.time.toFixed(3) : "—"} />
          <Metric k="Particles" v={t ? t.count.toLocaleString() : "—"} />
          <Metric k="Renderer" v={t ? t.backend.toUpperCase() : "—"} />
          <Metric k="FPS" v={t ? t.fps.toFixed(0) : "—"} />
        </dl>
      </section>
    </aside>
  );
}

function Slider(p: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="bb-label">
      <span className="bb-label-row"><span>{p.label}</span><span className="bb-val">{p.value}</span></span>
      <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={p.value}
        onChange={(e) => p.onChange(parseFloat(e.target.value))} />
    </label>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (<><dt>{k}</dt><dd>{v}</dd></>);
}
