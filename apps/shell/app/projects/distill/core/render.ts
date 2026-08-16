import type {
  Summary,
  CodeSymbol,
  CodeRegion,
  RefEdge,
  SummaryMode,
} from "./model";
import { DEFAULT_SUMMARY_MODE } from "./model";
import { behaviorLine } from "./behavior";

const KIND_TAG: Record<string, string> = {
  function: "fn",
  method: "fn",
  class: "class",
  interface: "iface",
  type: "type",
  enum: "enum",
  constant: "const",
  struct: "struct",
  trait: "trait",
  variable: "var",
  call: "call",
  other: "sym",
};

export type PrimaryRepr = "signature" | "name";

export interface FidelityPlan {
  primary: PrimaryRepr;
  includePrivate: boolean;
  importNames: boolean;
  sigMaxLen: number;
  behaviorLevel: 0 | 1 | 2;
  showState: boolean;
  stateCap: number;
  sourceCandidateCap: number;
  sourceBudgetRatio: number;
  // Per-candidate maximum number of evidence lines. Owned by the plan for
  // every mode so the renderer never special-cases a mode inline.
  evidenceLineCap: number;
}

export function planFidelity(
  mode: SummaryMode,
): FidelityPlan {
  switch (mode) {
    // detail is a strict deepening of full: strictly larger candidate cap,
    // evidence-line cap, and source budget, same output structure.
    case "detail":
      return {
        primary: "signature",
        behaviorLevel: 2,
        includePrivate: true,
        importNames: true,
        sigMaxLen: 180,
        showState: true,
        stateCap: 10,
        sourceCandidateCap: 8,
        sourceBudgetRatio: 0.24,
        evidenceLineCap: 8,
      };

    case "signatures":
      return {
        primary: "signature",
        behaviorLevel: 2,
        includePrivate: true,
        importNames: true,
        sigMaxLen: 180,
        showState: true,
        stateCap: 10,
        sourceCandidateCap: 0,
        sourceBudgetRatio: 0,
        evidenceLineCap: 0,
      };

    case "outline":
      return {
        primary: "signature",
        behaviorLevel: 1,
        includePrivate: false,
        importNames: false,
        sigMaxLen: 80,
        showState: false,
        stateCap: 8,
        sourceCandidateCap: 0,
        sourceBudgetRatio: 0,
        evidenceLineCap: 0,
      };

    case "names":
      return {
        primary: "name",
        behaviorLevel: 0,
        includePrivate: false,
        importNames: false,
        sigMaxLen: 80,
        showState: false,
        stateCap: 0,
        sourceCandidateCap: 0,
        sourceBudgetRatio: 0,
        evidenceLineCap: 0,
      };

    // full is a compact semantic reconstruction: the semantic sections carry
    // every declaration once, and ## code holds only a few high-signal
    // implementation lines the semantic model cannot express.
    case "full":
    default:
      return {
        primary: "signature",
        behaviorLevel: 2,
        includePrivate: true,
        importNames: true,
        sigMaxLen: 180,
        showState: true,
        stateCap: 10,
        sourceCandidateCap: 5,
        sourceBudgetRatio: 0.14,
        evidenceLineCap: 4,
      };
  }
}

const VIS_MARK: Record<string, string> = {
  private: "-",
  protected: "#",
  public: "+",
  internal: "#",
  unknown: " ",
};

/**
 * Only implementation-bearing symbols are eligible as source evidence.
 *
 * Declaration-shaped symbols (interfaces, enums, classes, structs, traits)
 * are fully represented once in ## api/## internal via their signature and
 * behavior line; reproducing their bodies here would only duplicate the
 * semantic sections. Imperative logic — control flow, guards, invariants,
 * side effects — lives in functions/methods and in editable/procedural
 * regions, which is exactly what ## code should carry.
 */
const EVIDENCE_SYMBOL_KINDS = new Set<CodeSymbol["kind"]>([
  "function",
  "method",
]);

/**
 * Kinds whose *entire* source range is already reconstructed in a semantic
 * section (## api/## internal/## state) and must therefore never be repeated
 * as source evidence. This is the exact complement of the body-bearing kinds:
 * a declaration is fully described by its signature + behavior line, so its
 * source lines are "already spoken for."
 */
const DECLARATION_KINDS = new Set<CodeSymbol["kind"]>([
  "constant",
  "variable",
  "interface",
  "type",
  "enum",
]);

/**
 * Kinds that carry an executable body we *do* want as evidence, but whose
 * header/signature is already printed in the semantic sections. For these we
 * subtract only the header lines (declaration → opening brace), so parameter
 * lines stop echoing the signature while the body remains available.
 */
const HEADER_ONLY_KINDS = new Set<CodeSymbol["kind"]>([
  "function",
  "method",
  "class",
  "struct",
  "trait",
]);

interface SourceCandidate {
  kind: "symbol" | "region";
  line: number;
  endLine: number;
  language: string;
  score: number;
  symbol?: CodeSymbol;
  region?: CodeRegion;
}

const IMPORTANT_SOURCE_TERMS =
  /\b(?:ajax|request|XMLHttpRequest|fetch|IncludeComponent|IncludeComponentTemplate|IncludeFile|includeModule|GetList|query|select|insert|update|delete|BX\.|onCustomEvent|set_params|set_resolution|step|render|resize|reset)\b/i;

const CONTROL_FLOW_TERMS =
  /\b(?:if|else|elseif|switch|case|match|for|foreach|while|do|try|catch|finally|return|throw|await)\b/i;

// Invariant / side-effect shapes the semantic model cannot express and that
// ## code exists to preserve. Phrased as generic pattern classes (not any one
// file's identifiers) so the scorer generalizes and survives the deletion test.
const GUARD_TERMS =
  /\b(?:Number\.isFinite|Number\.isNaN|isFinite|isNaN|Infinity|NaN)\b/;
const CLAMP_TERMS = /\bMath\.(?:min|max|abs|floor|ceil|round|hypot)\b/;
// Comparisons/uses of upper/lower-bound constants (MAX_*, MIN_*, *_MAX, *_CAP,
// *_LIMIT, *_DIMENSION, *_DT …) — the shape of per-frame caps and clamps.
const CAP_CONST_TERMS =
  /\b(?:(?:MAX|MIN)_[A-Z0-9_]+|[A-Z][A-Z0-9]*_(?:MAX|MIN|CAP|LIMIT|DIMENSION|DT|SIZE|COUNT))\b/;
const DRAIN_TERMS =
  /\b(?:shift|unshift|splice|drain|flush|dequeue|enqueue|queue|accumulat\w*|pending)\b/i;

const NOISE_ONLY = /^(?:\s*[{}();,]?\s*)$/;

function candidateSource(
  candidate: SourceCandidate,
  srcLines: string[],
): string {
  return srcLines
    .slice(candidate.line - 1, candidate.endLine)
    .join("\n");
}

function candidateScore(
  candidate: SourceCandidate,
  srcLines: string[],
): number {
  const text = candidateSource(candidate, srcLines);
  const span = Math.max(1, candidate.endLine - candidate.line + 1);

  let score = candidate.kind === "symbol" ? 22 : 8;

  if (
    candidate.symbol &&
    (candidate.symbol.kind === "function" || candidate.symbol.kind === "method")
  ) {
    score += 18;
  }

  score += Math.min(12, Math.ceil(span / 12));
  score += Math.min(30, (text.match(CONTROL_FLOW_TERMS)?.length ?? 0) * 6);
  score += Math.min(36, (text.match(IMPORTANT_SOURCE_TERMS)?.length ?? 0) * 9);

  if (GUARD_TERMS.test(text)) score += 10;
  if (CLAMP_TERMS.test(text)) score += 8;
  if (CAP_CONST_TERMS.test(text)) score += 8;
  if (DRAIN_TERMS.test(text)) score += 6;

  if (/\b(?:const|let|var)\b[^=\n]+=[\[{]/.test(text)) score += 5;
  if (/\b(?:async|await|try|catch|throw)\b/.test(text)) score += 5;
  if (candidate.symbol?.behavior?.mutatesState) score += 8;
  if (candidate.symbol?.behavior?.calls.length) {
    score += Math.min(14, candidate.symbol.behavior.calls.length * 2);
  }

  if (span > 80 && candidate.language === "php") score -= 24;
  return score;
}

function sameLanguageOverlap(a: SourceCandidate, b: SourceCandidate): boolean {
  return (
    a.language === b.language &&
    a.line <= b.endLine &&
    b.line <= a.endLine
  );
}

function normalizeCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      a.line - b.line ||
      b.endLine - b.line - (a.endLine - a.line),
  );

  const kept: SourceCandidate[] = [];

  for (const candidate of ordered) {
    const duplicate = kept.some((existing) => {
      if (!sameLanguageOverlap(existing, candidate)) return false;
      return (
        (candidate.line >= existing.line && candidate.endLine <= existing.endLine) ||
        (existing.line >= candidate.line && existing.endLine <= candidate.endLine)
      );
    });

    if (!duplicate) kept.push(candidate);
  }

  return kept;
}

function selectSourceCandidates(
  candidates: SourceCandidate[],
  srcLines: string[],
  cap: number,
): SourceCandidate[] {
  if (!cap || !candidates.length) return [];

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: candidateScore(candidate, srcLines),
    }))
    .filter((candidate) => candidate.score > 0);

  return normalizeCandidates(scored)
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, cap)
    .sort((a, b) => a.line - b.line);
}

function lineSignal(line: string): number {
  let score = 0;
  if (CONTROL_FLOW_TERMS.test(line)) score += 8;
  if (IMPORTANT_SOURCE_TERMS.test(line)) score += 10;
  if (GUARD_TERMS.test(line)) score += 12;
  if (CLAMP_TERMS.test(line)) score += 9;
  if (CAP_CONST_TERMS.test(line)) score += 9;
  if (DRAIN_TERMS.test(line)) score += 7;
  if (/\b(?:const|let|var)\b/.test(line)) score += 3;
  if (/\b(?:=|return|throw)\b/.test(line)) score += 2;
  if (/(?:https?:\/\/|\/ajax\/|["'][^"']{10,}["'])/.test(line)) score += 4;
  return score;
}

/**
 * Readability-preserving normalization.
 *
 * We deliberately do NOT glue operators, arrows, brackets, or commas together:
 * the size win must come from selecting fewer, higher-signal lines and from not
 * duplicating declarations, not from destroying whitespace. The only cleanup is
 * trimming trailing whitespace and clamping deep leading indentation to a small,
 * consistent amount so nested source does not blow out line width.
 */
const INDENT_CLAMP = 4;

function compactLine(line: string): string {
  const withoutTrailing = line.replace(/\s+$/, "");
  const leadingLen = (withoutTrailing.match(/^\s*/)?.[0] ?? "").length;
  const indent = Math.min(leadingLen, INDENT_CLAMP);
  return " ".repeat(indent) + withoutTrailing.trimStart();
}

/**
 * The header span of a body-bearing symbol: from its declaration line up to
 * and including the line that opens its body ("{"). Bounded to a few lines so
 * we only ever subtract the signature/parameter frame, never the body. If no
 * opening brace is found in range, fall back to the single declaration line.
 */
function headerEndLine(symbol: CodeSymbol, srcLines: string[]): number {
  const limit = Math.min(symbol.line + 8, srcLines.length);
  for (let ln = symbol.line; ln <= limit; ln++) {
    if (srcLines[ln - 1]?.includes("{")) return ln;
  }
  return symbol.line;
}

/**
 * The set of 1-based source lines already reconstructed by the semantic
 * sections. ## code must never repeat these — declarations are printed once as
 * signatures/state, and a body's signature is printed once in ## api. Both the
 * symbol and region evidence paths subtract this set, so the declaration filter
 * is a single invariant applied at two granularities rather than one filter
 * that exists (symbols) and one that is missing (regions).
 */
function collectRepresentedLines(
  symbols: CodeSymbol[],
  srcLines: string[],
): Set<number> {
  const represented = new Set<number>();

  for (const s of symbols) {
    if (DECLARATION_KINDS.has(s.kind)) {
      for (let ln = s.line; ln <= s.endLine && ln <= srcLines.length; ln++) {
        represented.add(ln);
      }
    } else if (HEADER_ONLY_KINDS.has(s.kind)) {
      const end = headerEndLine(s, srcLines);
      for (let ln = s.line; ln <= end && ln <= srcLines.length; ln++) {
        represented.add(ln);
      }
    }
  }

  return represented;
}

/**
 * Does a candidate still contain any line worth showing once the
 * already-represented lines and pure noise are removed? A region composed
 * entirely of declarations (a constant block, an interface body) collapses to
 * false here and is dropped — the region-path equivalent of the symbol-kind
 * gate, so declarations can never leak through regions.
 */
function hasResidualSignal(
  candidate: SourceCandidate,
  srcLines: string[],
  excluded: Set<number>,
): boolean {
  const to = Math.min(candidate.endLine, srcLines.length);
  for (let ln = candidate.line; ln <= to; ln++) {
    if (excluded.has(ln)) continue;
    const text = compactLine(srcLines[ln - 1]);
    if (!text || NOISE_ONLY.test(text)) continue;
    return true;
  }
  return false;
}

function compactSourceLines(
  srcLines: string[],
  from: number,
  to: number,
  maxLines: number,
  excluded: Set<number>,
): string[] {
  const entries: Array<{ line: number; text: string; score: number }> = [];

  for (let line = from; line <= to && line <= srcLines.length; line++) {
    if (excluded.has(line)) continue;
    const text = compactLine(srcLines[line - 1]);
    if (!text || NOISE_ONLY.test(text)) continue;
    entries.push({ line, text, score: lineSignal(text) });
  }

  if (!entries.length) return [];

  const pick = new Set<number>();
  const add = (entry: { line: number }) => pick.add(entry.line);
  const byScore = (
    a: { line: number; score: number },
    b: { line: number; score: number },
  ) => b.score - a.score || a.line - b.line;

  if (entries.length <= maxLines) {
    entries.forEach(add);
  } else if (entries.length <= maxLines * 2) {
    // Small span: its opening and closing frame are genuinely informative, so
    // keep the frame and fill the remaining slots by signal.
    entries.slice(0, 2).forEach(add);
    add(entries[entries.length - 1]);

    for (const entry of entries.slice(2, -1).sort(byScore)) {
      if (pick.size >= maxLines) break;
      add(entry);
    }
  } else {
    // Large span (e.g. a 300-line function body): the frame carries no signal
    // — the signature is already in ## api and the closing "};" is noise — so
    // spend every slot on the highest-signal lines (guards, clamps, drains,
    // invariants) instead of open-params and a closing brace.
    for (const entry of [...entries].sort(byScore)) {
      if (pick.size >= maxLines) break;
      add(entry);
    }
  }

  return [...pick]
    .sort((a, b) => a - b)
    .map((line) => {
      const entry = entries.find((e) => e.line === line)!;
      return `${line}:${entry.text}`;
    });
}

function sourceEvidence(
  srcLines: string[],
  candidate: SourceCandidate,
  lineCap: number,
  excluded: Set<number>,
): string[] {
  const compact = compactSourceLines(
    srcLines,
    candidate.line,
    candidate.endLine,
    Math.max(1, lineCap),
    excluded,
  );

  if (!compact.length) return [];

  const label = candidate.symbol
    ? `${KIND_TAG[candidate.symbol.kind] ?? "sym"} ${candidate.symbol.name}`
    : candidate.region?.kind === "procedural"
      ? `proc ${candidate.region.language}`
      : `region ${candidate.language}`;

  // Both full and detail present ## code as curated evidence, never as a body
  // dump, so the marker is uniform.
  return [
    `  evidence ${label} @${candidate.line}-${candidate.endLine} {`,
    ...compact.map((line) => `    ${line}`),
    "  }",
  ];
}

function truncateToBudget(lines: string[], budget: number): string[] {
  if (budget <= 0) return [];

  const kept: string[] = [];
  let used = 0;

  for (const line of lines) {
    const size = line.length + 1;
    if (used + size > budget) break;
    kept.push(line);
    used += size;
  }

  return kept;
}

export function render(
  summary: Summary,
  source: string,
  mode: SummaryMode = DEFAULT_SUMMARY_MODE,
): string {
  const {
    symbols,
    regions,
    dependencies,
    edges,
    notes,
    language,
    confidence,
  } = summary;

  const plan = planFidelity(mode);
  const nameOf = new Map(symbols.map((s) => [s.id, s.name]));
  const srcLines = source.split("\n");
  const semanticSymbols = symbols.filter((s) => s.kind !== "variable");
  const roots = semanticSymbols.filter((s) => !s.parentId);
  const variables = symbols.filter((s) => s.kind === "variable" && !s.parentId);
  const childrenOf = (id: string) => semanticSymbols.filter((s) => s.parentId === id);
  const arrow: Record<RefEdge["kind"], string> = {
    calls: "->",
    references: "~>",
    extends: "<|",
    implements: "<:",
  };

  const withheld: string[] = [];
  const head = [
    `# ${language} (${confidence}) symbols:${semanticSymbols.length} state:${variables.length} deps:${dependencies.length} mode:${mode}`,
  ];

  const depLines = dependencies.length
    ? [
        "## deps",
        ...dependencies.map((d) =>
          plan.importNames && d.names?.length
            ? `  ${d.module}:${d.names.join(",")}`
            : `  ${d.module}`,
        ),
      ]
    : [];

  if (dependencies.some((d) => d.names?.length) && !plan.importNames) {
    withheld.push("imported names");
  }

  const isPrivate = (s: CodeSymbol) =>
    s.visibility === "private" || s.visibility === "internal";

  const publicRoots = roots.filter((s) => !isPrivate(s));
  const privateRoots = roots.filter(isPrivate);

  const truncSig = (sig: string) =>
    sig.length > plan.sigMaxLen ? `${sig.slice(0, plan.sigMaxLen - 1)}…` : sig;

  const displaySignature = (s: CodeSymbol) =>
    truncSig(
      s.kind === "constant" || s.kind === "variable"
        ? s.signature.replace(/^\s*(?:const|let|var)\s+/, "")
        : s.signature,
    );

  const emitSym = (s: CodeSymbol, out: string[], indent: string) => {
    const mark = VIS_MARK[s.visibility] ?? " ";
    const tag = KIND_TAG[s.kind] ?? "sym";
    const label = plan.primary === "name" ? s.name : displaySignature(s);

    out.push(`${indent}${mark}${tag} ${label}@${s.line}`);

    if (plan.behaviorLevel > 0 && s.behavior) {
      const behavior = behaviorLine(s.behavior, plan.behaviorLevel);
      if (behavior) out.push(`${indent}  ·${behavior}`);
    }

    for (const child of childrenOf(s.id)) {
      emitSym(child, out, `${indent}  `);
    }
  };

  const apiLines = ["## api"];
  for (const s of publicRoots) emitSym(s, apiLines, "  ");

  const internalLines: string[] = [];
  if (plan.includePrivate && privateRoots.length) {
    internalLines.push("## internal");
    for (const s of privateRoots) emitSym(s, internalLines, "  ");
  } else if (privateRoots.length) {
    withheld.push("private/internal symbols");
  }

  const renderableRegions = regions
    .filter((r) => r.id.startsWith("editable") && r.language !== "markup")
    .sort((a, b) => a.line - b.line);

  // Lines already reconstructed once in the semantic sections. Both evidence
  // paths (symbols and regions) subtract these, so declarations — constants,
  // interfaces, enums, and signature/parameter frames — can never be repeated
  // in ## code regardless of how a file was carved.
  const representedLines = collectRepresentedLines(symbols, srcLines);

  const sourceCandidates: SourceCandidate[] = [
    ...roots
      .filter((s) => EVIDENCE_SYMBOL_KINDS.has(s.kind) && s.endLine > s.line)
      .map((symbol) => ({
        kind: "symbol" as const,
        line: symbol.line,
        endLine: symbol.endLine,
        language: symbol.language,
        score: 0,
        symbol,
      })),
    ...renderableRegions.map((region) => ({
      kind: "region" as const,
      line: region.line,
      endLine: region.endLine,
      language: region.language,
      score: 0,
      region,
    })),
    // A candidate whose lines are entirely declarations/noise once the
    // already-represented set is removed carries no implementation evidence and
    // is dropped before it can consume a candidate slot.
  ].filter((candidate) =>
    hasResidualSignal(candidate, srcLines, representedLines),
  );

  const selectedCandidates = selectSourceCandidates(
    sourceCandidates,
    srcLines,
    plan.sourceCandidateCap,
  );

  const sourceLines: string[] = [];
  if (plan.sourceCandidateCap > 0 && plan.sourceBudgetRatio > 0) {
    const evidence = selectedCandidates.flatMap((candidate) =>
      sourceEvidence(srcLines, candidate, plan.evidenceLineCap, representedLines),
    );

    const sourceBudget = Math.floor(source.length * plan.sourceBudgetRatio);
    const keptEvidence = truncateToBudget(evidence, sourceBudget);

    if (keptEvidence.length) {
      sourceLines.push("## code", ...keptEvidence);
    } else if (selectedCandidates.length) {
      withheld.push("source evidence budget exhausted");
    }

    const omitted = sourceCandidates.length - selectedCandidates.length;
    if (omitted > 0) withheld.push(`${omitted} lower-priority source span(s)`);
  } else if (sourceCandidates.length) {
    withheld.push("editable source bodies/regions");
  }

  const stateLines: string[] = [];
  if (plan.showState && variables.length) {
    const shown = variables.slice(0, plan.stateCap);
    stateLines.push("## state", ...shown.map((v) => `  ${truncSig(v.signature)}@${v.line}`));
    if (variables.length > shown.length) {
      withheld.push(`${variables.length - shown.length} more state capture(s)`);
    }
  } else if (variables.length) {
    withheld.push("state captures");
  }

  const refLines = edges.length
    ? ["## refs", ...edges.map((e) => `  ${nameOf.get(e.from) ?? e.from}${arrow[e.kind]}${nameOf.get(e.to) ?? e.to}`)]
    : [];

  const allNotes = [...notes];
  if (mode === "detail") {
    allNotes.push("detail: semantic inventory + scored source evidence; no verbatim bodies");
  } else if (mode === "signatures") {
    allNotes.push("signatures: source evidence withheld");
  } else if (mode === "names") {
    allNotes.push("names: signatures, state, behavior, and source withheld");
  }

  if (withheld.length) allNotes.push(`withheld: ${withheld.join("; ")}`);

  const noteLines = allNotes.length
    ? ["## notes", ...allNotes.map((n) => `  !${n}`)]
    : [];

  let output = [
    head,
    apiLines,
    depLines,
    internalLines,
    sourceLines,
    stateLines,
    refLines,
    noteLines,
  ]
    .filter((block) => block.length)
    .map((block) => block.join("\n"))
    .join("\n")
    .trim();

  if (output) output += "\n";
  return output;
}