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

export type PrimaryRepr =
  | "bodies"
  | "signature"
  | "name";

export interface FidelityPlan {
  primary: PrimaryRepr;
  includePrivate: boolean;
  importNames: boolean;
  sigMaxLen: number;
  behaviorLevel: 0 | 1 | 2;
  showState: boolean;
  stateCap: number;

  // Source selection is intentionally separate from semantic fidelity.
  // `full` emits selected bodies/regions verbatim.
  // `detail` emits sketches of selected bodies/regions.
  sourceCandidateCap: number;
  sketchLineCap: number;
}

export function planFidelity(
  mode: SummaryMode,
): FidelityPlan {
  switch (mode) {
    case "detail":
      return {
        primary: "signature",
        behaviorLevel: 2,
        includePrivate: true,
        importNames: true,
        sigMaxLen: 200,
        showState: true,
        stateCap: 12,
        sourceCandidateCap: 8,
        sketchLineCap: 7,
      };

    case "signatures":
      return {
        primary: "signature",
        behaviorLevel: 2,
        includePrivate: true,
        importNames: true,
        sigMaxLen: 200,
        showState: true,
        stateCap: 12,
        sourceCandidateCap: 0,
        sketchLineCap: 0,
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
        sketchLineCap: 0,
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
        sketchLineCap: 0,
      };

    case "full":
    default:
      return {
        primary: "bodies",
        behaviorLevel: 2,
        includePrivate: true,
        importNames: true,
        sigMaxLen: 200,
        showState: true,
        stateCap: 12,
        sourceCandidateCap: 6,
        sketchLineCap: 0,
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

const BODY_ROOT_KINDS = new Set<CodeSymbol["kind"]>([
  "function",
  "method",
  "class",
  "struct",
  "interface",
  "trait",
  "enum",
]);

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

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
  /\b(?:ajax|basket|request|XMLHttpRequest|fetch|IncludeComponent|IncludeComponentTemplate|IncludeFile|includeModule|GetList|query|select|insert|update|delete|BX\.|onCustomEvent)\b/i;

const CONTROL_FLOW_TERMS =
  /\b(?:if|elseif|else|switch|match|for|foreach|while|do|try|catch|finally|return|throw)\b/i;

function candidateSource(
  candidate: SourceCandidate,
  srcLines: string[],
): string {
  return srcLines
    .slice(
      candidate.line - 1,
      candidate.endLine,
    )
    .join("\n");
}

function candidateScore(
  candidate: SourceCandidate,
  srcLines: string[],
): number {
  const text = candidateSource(
    candidate,
    srcLines,
  );

  const span =
    Math.max(
      1,
      candidate.endLine -
        candidate.line +
        1,
    );

  let score =
    candidate.kind === "symbol"
      ? 24
      : 10;

  // Named callables are more informative than anonymous source gaps.
  if (
    candidate.symbol &&
    (
      candidate.symbol.kind === "function" ||
      candidate.symbol.kind === "method"
    )
  ) {
    score += 16;
  }

  // Containers are useful, but should lose to actual routines when otherwise
  // comparable, since dumping a giant class/file body is low-density.
  if (
    candidate.symbol &&
    (
      candidate.symbol.kind === "class" ||
      candidate.symbol.kind === "interface" ||
      candidate.symbol.kind === "struct" ||
      candidate.symbol.kind === "trait" ||
      candidate.symbol.kind === "enum"
    )
  ) {
    score += 6;
  }

  score += Math.min(
    18,
    Math.ceil(span / 8),
  );

  const controlHits =
    text.match(
      CONTROL_FLOW_TERMS,
    )?.length ?? 0;

  score += Math.min(
    30,
    controlHits * 6,
  );

  const importantHits =
    text.match(
      IMPORTANT_SOURCE_TERMS,
    )?.length ?? 0;

  score += Math.min(
    30,
    importantHits * 8,
  );

  if (
    /(?:\b(?:const|let|var)\b[^=\n]+=\s*[\[{])/.test(
      text,
    )
  ) {
    score += 5;
  }

  if (
    /\b(?:async|await|try|catch|throw)\b/.test(
      text,
    )
  ) {
    score += 6;
  }

  if (
    candidate.symbol?.behavior
      ?.mutatesState
  ) {
    score += 8;
  }

  if (
    candidate.symbol?.behavior
      ?.calls.length
  ) {
    score += Math.min(
      16,
      candidate.symbol.behavior.calls.length * 2,
    );
  }

  // Very large homogeneous PHP spans are exactly the kind of source that
  // inflates the original output without adding proportionate information.
  if (
    candidate.language === "php" &&
    span > 80 &&
    controlHits === 0 &&
    importantHits === 0
  ) {
    score -= 60;
  }

  return score;
}

function sameLanguageOverlap(
  a: SourceCandidate,
  b: SourceCandidate,
): boolean {
  return (
    a.language === b.language &&
    overlaps(
      a.line,
      a.endLine,
      b.line,
      b.endLine,
    )
  );
}

function normalizeCandidates(
  candidates: SourceCandidate[],
): SourceCandidate[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      (b.endLine - b.line) -
        (a.endLine - a.line) ||
      a.line - b.line,
  );

  const kept: SourceCandidate[] = [];

  for (const candidate of ordered) {
    const duplicate = kept.some(
      (existing) =>
        sameLanguageOverlap(
          existing,
          candidate,
        ) &&
        (
          (
            candidate.line >=
              existing.line &&
            candidate.endLine <=
              existing.endLine
          ) ||
          (
            existing.line >=
              candidate.line &&
            existing.endLine <=
              candidate.endLine
          )
        ),
    );

    if (!duplicate) {
      kept.push(candidate);
    }
  }

  return kept.sort(
    (a, b) =>
      a.line - b.line ||
      b.score - a.score,
  );
}

function selectSourceCandidates(
  candidates: SourceCandidate[],
  srcLines: string[],
  cap: number,
): SourceCandidate[] {
  if (!cap || !candidates.length) {
    return [];
  }

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: candidateScore(
        candidate,
        srcLines,
      ),
    }))
    .filter(
      (candidate) =>
        candidate.score > 0,
    );

  const deduped =
    normalizeCandidates(scored);

  return deduped
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.line - b.line,
    )
    .slice(0, cap)
    .sort(
      (a, b) =>
        a.line - b.line,
    );
}

function lineSignal(
  line: string,
): number {
  let score = 0;

  if (CONTROL_FLOW_TERMS.test(line)) {
    score += 7;
  }

  if (
    IMPORTANT_SOURCE_TERMS.test(line)
  ) {
    score += 8;
  }

  if (
    /\b(?:const|let|var)\b/.test(line)
  ) {
    score += 2;
  }

if (/(?:=|return|throw)\b/.test(line)) {
  score += 1;
}

  if (
    /(?:https?:\/\/|\/ajax\/|["'][^"']{10,}["'])/.test(
      line,
    )
  ) {
    score += 3;
  }

  return score;
}

function sketchLines(
  srcLines: string[],
  from: number,
  to: number,
  cap: number,
): Array<
  number | "ellipsis"
> {
  const entries: Array<{
    line: number;
    score: number;
  }> = [];

  for (
    let line = from;
    line <= to &&
    line <= srcLines.length;
    line++
  ) {
    if (!srcLines[line - 1].trim()) {
      continue;
    }

    entries.push({
      line,
      score: lineSignal(
        srcLines[line - 1],
      ),
    });
  }

  if (!entries.length) {
    return [];
  }

  if (entries.length <= cap) {
    return entries.map(
      (e) => e.line,
    );
  }

  const selected = new Set<number>();

  // Always preserve the opening context.
  for (
    const e of entries.slice(0, 2)
  ) {
    selected.add(e.line);
  }

  // Always preserve closure/result context.
  selected.add(
    entries[entries.length - 1].line,
  );

  const middle = entries
    .slice(2, -1)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.line - b.line,
    );

  for (const e of middle) {
    if (selected.size >= cap) {
      break;
    }

    selected.add(e.line);
  }

  const ordered = [...selected].sort(
    (a, b) => a - b,
  );

  const out: Array<
    number | "ellipsis"
  > = [];

  for (
    let i = 0;
    i < ordered.length;
    i++
  ) {
    if (
      i > 0 &&
      ordered[i] >
        ordered[i - 1] + 1
    ) {
      out.push("ellipsis");
    }

    out.push(ordered[i]);
  }

  return out;
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
  const nameOf = new Map(
    symbols.map((s) => [s.id, s.name]),
  );
  const srcLines = source.split("\n");

  const semanticSymbols =
    symbols.filter(
      (s) => s.kind !== "variable",
    );

  const roots = semanticSymbols.filter(
    (s) => !s.parentId,
  );

// Only document/module-scope variables are state. Locals inside functions or
// callbacks are implementation detail and must not inflate the summary.
const variables = symbols.filter(
  (s) =>
    s.kind === "variable" &&
    !s.parentId,
);

  const childrenOf = (id: string) =>
    semanticSymbols.filter(
      (s) => s.parentId === id,
    );

  const arrow: Record<
    RefEdge["kind"],
    string
  > = {
    calls: "->",
    references: "~>",
    extends: "<|",
    implements: "<:",
  };

  const withheld: string[] = [];

  const head = [
    `# ${language} (${confidence})  symbols:${semanticSymbols.length} state:${variables.length} deps:${dependencies.length} mode:${mode}`,
  ];

  const depLines = dependencies.length
    ? [
        "## deps",
        ...dependencies.map((d) =>
          plan.importNames &&
          d.names?.length
            ? `  ${d.module}: ${d.names.join(", ")}`
            : `  ${d.module}`,
        ),
      ]
    : [];

  if (
    dependencies.some(
      (d) => d.names?.length,
    ) &&
    !plan.importNames
  ) {
    withheld.push(
      "imported-name detail",
    );
  }

  const isPrivate = (
    s: CodeSymbol,
  ) =>
    s.visibility === "private" ||
    s.visibility === "internal";

  const publicRoots = roots.filter(
    (s) => !isPrivate(s),
  );

  const privateRoots = roots.filter(
    isPrivate,
  );

  const truncSig = (sig: string) =>
    sig.length > plan.sigMaxLen
      ? sig.slice(
          0,
          plan.sigMaxLen - 1,
        ) + "…"
      : sig;

  const numbered = (
    from: number,
    to: number,
    indent: string,
  ): string[] => {
    const out: string[] = [];
    const width = String(
      Math.min(
        to,
        srcLines.length,
      ),
    ).length;

    for (
      let L = from;
      L <= to &&
      L <= srcLines.length;
      L++
    ) {
      out.push(
        `${indent}${String(L).padStart(width)}| ${srcLines[L - 1]}`,
      );
    }

    return out;
  };

  const displaySignature = (
    s: CodeSymbol,
  ): string => {
    if (
      s.kind !== "constant" &&
      s.kind !== "variable"
    ) {
      return truncSig(s.signature);
    }

    return truncSig(
      s.signature.replace(
        /^\s*(?:const|let|var)\s+/,
        "",
      ),
    );
  };

  const emitSym = (
    s: CodeSymbol,
    out: string[],
    indent: string,
  ) => {
    const mark =
      VIS_MARK[s.visibility] ?? " ";

    const tag =
      KIND_TAG[s.kind] ?? "sym";

const label =
  plan.primary === "name"
    ? s.name
    : (
        s.kind === "constant" ||
        s.kind === "variable"
      )
      ? displaySignature(s)
      : truncSig(s.signature);

    const languageSuffix =
      mode === "full" &&
      s.language !== language &&
      s.kind !== "variable"
        ? ` [${s.language}]`
        : "";

    out.push(
      `${indent}${mark}${tag} ${label}${languageSuffix}  @${s.line}`,
    );

    if (
      plan.behaviorLevel > 0 &&
      s.behavior
    ) {
      const bl = behaviorLine(
        s.behavior,
        plan.behaviorLevel,
      );

      if (bl) {
        out.push(
          `${indent}    · ${bl}`,
        );
      }
    }

    for (const child of childrenOf(s.id)) {
      emitSym(
        child,
        out,
        indent + "    ",
      );
    }
  };

  const apiLines: string[] = ["## api"];

  for (const s of publicRoots) {
    emitSym(
      s,
      apiLines,
      "  ",
    );
  }

  const internalLines: string[] = [];

  if (
    plan.includePrivate &&
    privateRoots.length
  ) {
    internalLines.push(
      "## internal",
    );

    for (const s of privateRoots) {
      emitSym(
        s,
        internalLines,
        "  ",
      );
    }
  } else if (privateRoots.length) {
    withheld.push(
      "private/internal symbols",
    );
  }

  const bodyRoots = roots.filter(
    (s) =>
      BODY_ROOT_KINDS.has(s.kind) &&
      s.endLine > s.line,
  );

  // `segmentSource()` regions are structural metadata. They are NOT themselves
  // render candidates, otherwise a whole PHP/Bitrix source region gets dumped
  // before the derived meaningful gaps are considered.
  //
  // `deriveEditableRegions()` uses `editable*` IDs for the actual uncovered
  // executable spans that may be rendered.
  const renderableRegions =
    regions
      .filter(
        (r) =>
          r.id.startsWith("editable") &&
          r.language !== "markup",
      )
      .sort(
        (a, b) =>
          a.line - b.line,
      );

  const sourceCandidates: SourceCandidate[] =
    [
      ...bodyRoots.map((symbol) => ({
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
    ];

  const selectedCandidates =
    selectSourceCandidates(
      sourceCandidates,
      srcLines,
      plan.sourceCandidateCap,
    );

  const codeLines: string[] = [];

  if (
    mode === "full" ||
    mode === "detail"
  ) {
    if (selectedCandidates.length) {
      codeLines.push("## code");

      for (
        const candidate of
          selectedCandidates
      ) {
        if (
          mode === "full" &&
          candidate.kind === "symbol" &&
          candidate.symbol
        ) {
          const s = candidate.symbol;

          codeLines.push(
            `  ${KIND_TAG[s.kind] ?? "sym"} ${s.name} [${s.language}]  @${s.line}-${s.endLine}`,
          );

          codeLines.push(
            ...numbered(
              s.line,
              s.endLine,
              "  ",
            ),
          );

          codeLines.push("");
          continue;
        }

        if (
          mode === "full" &&
          candidate.kind === "region" &&
          candidate.region
        ) {
          const r =
            candidate.region;

          const label =
            r.kind === "procedural"
              ? "procedural"
              : "region";

          codeLines.push(
            `  ${label} ${r.language}  @${r.line}-${r.endLine}`,
          );

          codeLines.push(
            ...numbered(
              r.line,
              r.endLine,
              "  ",
            ),
          );

          codeLines.push("");
          continue;
        }

        if (
          mode === "detail"
        ) {
          const label =
            candidate.symbol
              ? `${KIND_TAG[candidate.symbol.kind] ?? "sym"} ${candidate.symbol.name}`
              : candidate.region?.kind ===
                "procedural"
                ? `procedural ${candidate.region.language}`
                : `region ${candidate.language}`;

          codeLines.push(
            `  sketch ${label}  @${candidate.line}-${candidate.endLine}`,
          );

          const sketch =
            sketchLines(
              srcLines,
              candidate.line,
              candidate.endLine,
              plan.sketchLineCap,
            );

          for (
            const item of sketch
          ) {
            if (
              item === "ellipsis"
            ) {
              codeLines.push(
                "    …",
              );
              continue;
            }

            const width =
              String(
                Math.min(
                  candidate.endLine,
                  srcLines.length,
                ),
              ).length;

            codeLines.push(
              `    ${String(item).padStart(width)}| ${srcLines[item - 1]}`,
            );
          }

          codeLines.push("");
        }
      }

      while (
        codeLines.length &&
        codeLines[
          codeLines.length - 1
        ] === ""
      ) {
        codeLines.pop();
      }
    } else {
      withheld.push(
        "no high-value source spans selected",
      );
    }

    const omitted =
      sourceCandidates.length -
      selectedCandidates.length;

    if (omitted > 0) {
      withheld.push(
        `${omitted} lower-priority source span(s)`,
      );
    }
  } else if (
    sourceCandidates.length
  ) {
    withheld.push(
      "editable source bodies/regions",
    );
  }

  const stateLines: string[] = [];

  if (
    plan.showState &&
    variables.length
  ) {
    const shown = variables.slice(
      0,
      plan.stateCap,
    );

    stateLines.push("## state");

    for (const v of shown) {
      stateLines.push(
        `  ${truncSig(v.signature)}  @${v.line}`,
      );
    }

    if (
      variables.length >
      shown.length
    ) {
      withheld.push(
        `${variables.length - shown.length} more state capture(s)`,
      );
    }
  } else if (variables.length) {
    withheld.push(
      "state captures",
    );
  }

  const refLines: string[] = [];

  if (edges.length) {
    refLines.push("## refs");

    for (const e of edges) {
      refLines.push(
        `  ${nameOf.get(e.from)} ${arrow[e.kind]} ${nameOf.get(e.to)}`,
      );
    }
  }

  const allNotes = [...notes];

  if (
    mode === "detail"
  ) {
    allNotes.push(
      'mode detail: selected source bodies/regions are represented as compact sketches; full source is reserved for mode "full"',
    );
  } else if (
    mode === "signatures"
  ) {
    allNotes.push(
      'mode signatures: editable source bodies/regions withheld; use mode "detail" or "full" for source context',
    );
  } else if (
    plan.primary === "name"
  ) {
    allNotes.push(
      `mode ${mode}: signatures, state, behavior, and editable source withheld; reference graph only`,
    );
  }

  if (
    plan.behaviorLevel < 2
  ) {
    allNotes.push(
      `mode ${mode}: behavioral layer is partial — use a richer mode for fuller source-visible behavior`,
    );
  }

  if (
    mode !== "full" &&
    renderableRegions.length
  ) {
    allNotes.push(
      `mode ${mode}: ${renderableRegions.length} editable source region(s) withheld`,
    );
  }

  if (withheld.length) {
    allNotes.push(
      `mode ${mode}: withheld ${withheld.join(", ")}`,
    );
  }

  const noteLines = allNotes.length
    ? [
        "## notes",
        ...allNotes.map(
          (n) => `  ! ${n}`,
        ),
      ]
    : [];

  const blocks = [
    head,
    apiLines,
    depLines,
    internalLines,
    codeLines,
    stateLines,
    refLines,
    noteLines,
  ];

  return (
    blocks
      .filter((b) => b.length)
      .map((b) => b.join("\n"))
      .join("\n")
      .trim() + "\n"
  );
}