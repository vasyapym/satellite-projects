// The language-independent lingua franca that decouples "how we read language X"
// from "how we present anything." Every field must earn its place (deletion test).

export type SymbolKind =
  | "function" | "method" | "class" | "interface"
  | "type" | "enum" | "constant" | "struct" | "trait"
  | "variable"
  | "call"
  | "other";

export type Visibility = "public" | "protected" | "private" | "internal" | "unknown";

/**
 * A source region is not a semantic symbol.
 *
 * `source` regions describe contiguous source language.
 * `procedural` regions describe executable source that matters for editing
 * but does not naturally deserve one symbol per statement.
 *
 * All line ranges are inclusive and 1-based.
 */
export type CodeRegionKind = "source" | "procedural";

export type CodeRegionLanguage = "php" | "javascript" | "markup" | string;

export interface CodeRegion {
  id: string;
  kind: CodeRegionKind;
  language: CodeRegionLanguage;
  line: number;
  endLine: number;
}

// Cheap, defensible static facts about what a symbol does.
// These are source-visible facts, not semantic guesses.
export interface SymbolBehavior {
  async: boolean;
  recursive: boolean;
  branches: boolean;
  loops: boolean;
  throws: boolean;
  handlesErrors: boolean;
  mutatesState: boolean;
  returns: "value" | "void" | "unknown";
  calls: string[];
}

export interface CodeSymbol {
  id: string;
  kind: SymbolKind;
  name: string;
  signature: string;
  visibility: Visibility;

  // 1-based source range.
  line: number;
  endLine: number;

  // The actual language definition used for extraction/behavior.
  // Example: "bitrix" for a PHP/Bitrix symbol and "typescript" for JS.
  language: string;

  // Source-region identity, when extraction happened inside a segmented file.
  regionId?: string;

  parentId?: string;
  behavior?: SymbolBehavior;
}

export type EdgeKind = "calls" | "extends" | "implements" | "references";

export interface RefEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface Dependency {
  module: string;
  names?: string[];
}

export interface Summary {
  language: string;
  confidence: "structural" | "heuristic";
  symbols: CodeSymbol[];
  regions: CodeRegion[];
  dependencies: Dependency[];
  edges: RefEdge[];
  notes: string[];
}

// Named output modes, richest → leanest:
//
//   full       — bounded, selected source bodies/regions + rich semantic inventory
//   detail     — rich semantic inventory + compact source sketches; no full bodies
//   signatures — semantic signatures + behavior + compact state; no source
//   outline    — compact public semantic inventory + terse behavior
//   names      — names + reference graph only
export type SummaryMode =
  | "full"
  | "detail"
  | "signatures"
  | "outline"
  | "names";

export const SUMMARY_MODES: readonly SummaryMode[] = [
  "full",
  "detail",
  "signatures",
  "outline",
  "names",
];

export const DEFAULT_SUMMARY_MODE: SummaryMode = "full";

export interface SummarizeOptions {
  language?: string;
  mode?: SummaryMode;
}