"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SUMMARY_MODE, SUMMARY_MODES } from "./core/model";
import type { SummaryMode } from "./core/model";
import styles from "./distill.module.css";

const LANGS = [
  ["auto", "Auto-detect"], ["typescript", "TypeScript / JS"],
  ["python", "Python"], ["go", "Go"], ["rust", "Rust"],
  ["php", "PHP"], ["bitrix", "Bitrix (PHP)"], ["generic", "Generic"],
] as const;

const MODE_LABELS: Record<SummaryMode, string> = {
  full: "Full bodies",
  detail: "Detailed sketches",
  signatures: "Signatures",
  outline: "Outline",
  names: "Names only",
};

const MODES = SUMMARY_MODES.map((mode) => [mode, MODE_LABELS[mode]] as const);

const SAMPLE = `import { readFile } from "fs/promises";

export interface Repo { save(id: string): Promise<void>; }

export class FileRepo implements Repo {
  private path: string;
  constructor(path: string) { this.path = path; }
  async save(id: string): Promise<void> { await this.load(id); }
  private async load(id: string) { return readFile(this.path); }
}

export function makeRepo(p: string): Repo { return new FileRepo(p); }
`;

export function Distill() {
  const [source, setSource] = useState(SAMPLE);
  const [language, setLanguage] = useState<string>("auto");
  const [mode, setMode] = useState<SummaryMode>(DEFAULT_SUMMARY_MODE);
  const [out, setOut] = useState("");
  const [meta, setMeta] = useState<{ language: string; confidence: string; symbolCount: number } | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setErr("");
      try {
        const res = await fetch("/projects/distill/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, language, mode }),
        });
        const json = await res.json();
        if (!res.ok) { setErr(json.error ?? "Error"); setOut(""); setMeta(null); return; }
        setOut(json.text);
        setMeta({ language: json.language, confidence: json.confidence, symbolCount: json.symbolCount });
      } catch {
        setErr("Network error");
      }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [source, language, mode]);

  const copy = async () => {
    await navigator.clipboard.writeText(out);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={styles.grid}>
      <div className={styles.pane}>
        <div className={styles.controls}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className={styles.select}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SummaryMode)}
            className={styles.select}
            aria-label="summary mode"
          >
            {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <textarea
          className={styles.editor} value={source} spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Paste source code in any language…"
        />
      </div>

      <div className={styles.pane}>
        <div className={styles.controls}>
          <span className={styles.meta}>
            {meta ? `${meta.language} · ${meta.confidence} · ${meta.symbolCount} symbols` : "—"}
          </span>
          <button className={styles.copy} onClick={copy} disabled={!out}>
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
        {err
          ? <pre className={`${styles.output} ${styles.error}`}>{err}</pre>
          : <pre className={styles.output}>{out}</pre>}
      </div>
    </div>
  );
}
