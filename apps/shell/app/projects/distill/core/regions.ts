import type {
  CodeRegion,
  CodeRegionLanguage,
  CodeSymbol,
} from "./model";
import type { LanguageDef } from "./languages";

function sourceLanguageOf(lang: LanguageDef): CodeRegionLanguage {
  if (lang.id === "php" || lang.id === "bitrix") return "php";
  if (lang.id === "typescript") return "javascript";
  return lang.id;
}

function pushRegion(
  out: CodeRegion[],
  id: string,
  kind: CodeRegion["kind"],
  language: CodeRegionLanguage,
  line: number,
  endLine: number,
): void {
  if (line > endLine) return;

  out.push({
    id,
    kind,
    language,
    line,
    endLine,
  });
}

/**
 * Segment a PHP/Bitrix template into language-safe source regions.
 *
 * Deliberately small scanner:
 *   markup -> PHP
 *   markup -> JavaScript (<script>)
 *   PHP -> markup (?>)
 *   JavaScript -> markup (</script>)
 *
 * Script tag lines remain markup. PHP tag lines are owned by PHP because
 * Bitrix commonly writes `<?php $x = ...` on the same line.
 *
 * The model is line-addressable, so boundaries are intentionally line-based.
 */
export function segmentSource(
  src: string,
  lang: LanguageDef,
): CodeRegion[] {
  const lines = src.split("\n");
  const total = lines.length;

  if (
    lang.id !== "php" &&
    lang.id !== "bitrix"
  ) {
    return [{
      id: "r0",
      kind: "source",
      language: sourceLanguageOf(lang),
      line: 1,
      endLine: total,
    }];
  }

  const hasMixedMarkers =
    /<\?(?:php\b|=|\s)/i.test(src) ||
    /<script\b/i.test(src) ||
    /<\/script\s*>/i.test(src) ||
    /\?>/.test(src);

  // Plain PHP / Bitrix source without template transitions keeps the existing
  // homogeneous path semantically intact.
  if (!hasMixedMarkers) {
    return [{
      id: "r0",
      kind: "source",
      language: "php",
      line: 1,
      endLine: total,
    }];
  }

  type State = "markup" | "php" | "javascript";

  const startsAsPhp = /^\s*<\?(?:php\b|=|\s)/i.test(lines[0] ?? "");
  let state: State = startsAsPhp ? "php" : "markup";
  let startLine = 1;
  let nextId = 0;

  const regions: CodeRegion[] = [];

  const emit = (
    kind: CodeRegion["kind"],
    language: CodeRegionLanguage,
    from: number,
    to: number,
  ) => {
    pushRegion(regions, `r${nextId++}`, kind, language, from, to);
  };

  for (let i = 0; i < total; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (state === "markup") {
      const php = line.match(/<\?(?:php\b|=|\s)/i);

      if (php) {
        emit("source", "markup", startLine, lineNo - 1);
        state = "php";
        startLine = lineNo;

        // A same-line closing tag means there is no following PHP state.
        const phpStart = php.index ?? 0;
        const close = line.indexOf(
        "?>",
        phpStart + php[0].length,
        );
        if (close >= 0) {
          emit("source", "php", startLine, lineNo);
          state = "markup";
          startLine = lineNo + 1;
        }
        continue;
      }

      if (/<script\b[^>]*>/i.test(line)) {
        emit("source", "markup", startLine, lineNo);
        state = "javascript";
        startLine = lineNo + 1;
      }

      continue;
    }

    if (state === "php") {
      const close = line.indexOf("?>");

      if (close >= 0) {
        emit("source", "php", startLine, lineNo);
        state = "markup";
        startLine = lineNo + 1;
      }

      continue;
    }

    // javascript
    if (/<\/script\s*>/i.test(line)) {
      emit("source", "javascript", startLine, lineNo - 1);
      state = "markup";
      startLine = lineNo;
    }
  }

  if (startLine <= total) {
    emit(
      "source",
      state === "php"
        ? "php"
        : state === "javascript"
          ? "javascript"
          : "markup",
      startLine,
      total,
    );
  }

  // Collapse accidental empty/adjacent fragments of identical language.
  const merged: CodeRegion[] = [];

  for (const region of regions) {
    const prev = merged[merged.length - 1];

    if (
      prev &&
      prev.language === region.language &&
      prev.kind === region.kind &&
      prev.endLine + 1 === region.line
    ) {
      prev.endLine = region.endLine;
      continue;
    }

    merged.push({
      ...region,
      id: `r${merged.length}`,
    });
  }

  return merged.length
    ? merged
    : [{
        id: "r0",
        kind: "source",
        language: sourceLanguageOf(lang),
        line: 1,
        endLine: total,
      }];
}

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

function subtractRanges(
  regionLine: number,
  regionEndLine: number,
  occupied: Array<{ line: number; endLine: number }>,
): Array<{ line: number; endLine: number }> {
  const sorted = [...occupied]
    .filter((r) =>
      overlaps(regionLine, regionEndLine, r.line, r.endLine),
    )
    .map((r) => ({
      line: Math.max(regionLine, r.line),
      endLine: Math.min(regionEndLine, r.endLine),
    }))
    .sort((a, b) => a.line - b.line);

  const gaps: Array<{ line: number; endLine: number }> = [];
  let cursor = regionLine;

  for (const range of sorted) {
    if (range.line > cursor) {
      gaps.push({
        line: cursor,
        endLine: range.line - 1,
      });
    }

    cursor = Math.max(cursor, range.endLine + 1);

    if (cursor > regionEndLine) break;
  }

  if (cursor <= regionEndLine) {
    gaps.push({
      line: cursor,
      endLine: regionEndLine,
    });
  }

  return gaps;
}

function hasMeaningfulSource(
  src: string,
  line: number,
  endLine: number,
): boolean {
  const lines = src
    .split("\n")
    .slice(line - 1, endLine);

  const meaningful = lines.filter((raw) => {
    const t = raw.trim();

    return (
      t &&
      t !== "<?php" &&
      t !== "<?" &&
      t !== "?>" &&
      !/^<!--.*-->$/.test(t)
    );
  });

  if (!meaningful.length) {
    return false;
  }

  // Do not promote tiny template fragments merely because they contain PHP.
  // This eliminates the one-line / two-line interpolation flood seen in the
  // original sample output.
  if (meaningful.length >= 4) {
    return true;
  }

  const joined = meaningful.join("\n");

  // Small spans are still worth preserving when they express actual control
  // flow or framework orchestration.
  const hasControlFlow =
    /\b(?:if|elseif|else|switch|match|for|foreach|while|do|try|catch|finally)\b/
      .test(joined);

  const hasFrameworkCall =
    /\b(?:IncludeComponent|SetTitle|IncludeFile|IncludeComponentTemplate|includeModule|GetList)\s*\(/
      .test(joined);

  // Preserve compact but information-dense literals/data construction.
  const hasNonTrivialLiteral =
    /(?:https?:\/\/|\/ajax\/|XMLHttpRequest|fetch\s*\(|\[[\s\S]{8,}\]|["'][^"']{12,}["'])/
      .test(joined);

  return (
    hasControlFlow ||
    hasFrameworkCall ||
    hasNonTrivialLiteral
  );
}

/**
 * Derive editable source gaps after semantic body-owning symbols have claimed
 * their source ranges.
 *
 * PHP gaps become `procedural`.
 * JavaScript / other executable gaps remain `source`.
 * Markup is never emitted here.
 */
export function deriveEditableRegions(
  src: string,
  regions: CodeRegion[],
  symbols: CodeSymbol[],
): CodeRegion[] {
  const roots = symbols.filter(
    (s) =>
      !s.parentId &&
      s.kind !== "variable" &&
      BODY_ROOT_KINDS.has(s.kind) &&
      s.endLine >= s.line,
  );

  const out: CodeRegion[] = [];
  let nextId = 0;

  for (const region of regions) {
    if (region.language === "markup") continue;

    const occupied = roots
      .filter((s) => s.regionId === region.id)
      .map((s) => ({
        line: s.line,
        endLine: s.endLine,
      }));

    const gaps = subtractRanges(
      region.line,
      region.endLine,
      occupied,
    );

    for (const gap of gaps) {
      if (!hasMeaningfulSource(src, gap.line, gap.endLine)) continue;

      out.push({
        id: `editable${nextId++}`,
        kind:
          region.language === "php"
            ? "procedural"
            : "source",
        language: region.language,
        line: gap.line,
        endLine: gap.endLine,
      });
    }
  }

  return out;
}