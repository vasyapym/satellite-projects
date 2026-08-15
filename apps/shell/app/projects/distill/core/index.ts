import type {
  Summary,
  SummarizeOptions,
  SummaryMode,
  CodeRegion,
  CodeSymbol,
  Dependency,
} from "./model";

import {
  SUMMARY_MODES,
  DEFAULT_SUMMARY_MODE,
} from "./model";

import {
  resolveLanguage,
  sniffLanguage,
  BITRIX,
  PHP,
  TS,
} from "./languages";

import { extract } from "./extract";
import { relate } from "./relate";
import { analyzeBehavior } from "./behavior";
import {
  render,
  planFidelity,
} from "./render";

import {
  segmentSource,
  deriveEditableRegions,
} from "./regions";

export * from "./model";

export interface SummarizeResult {
  summary: Summary;
  text: string;
}

// The single pure function: (source, options) -> summary.
// No Next/React/HTTP.
export function summarize(
  source: string,
  opts: SummarizeOptions = {},
): SummarizeResult {
  const notes: string[] = [];

  // Resolve the requested mode against the known set.
  // An unknown runtime value degrades to the default and is recorded honestly.
  let mode: SummaryMode =
    DEFAULT_SUMMARY_MODE;

  if (opts.mode !== undefined) {
    const requestedMode =
      opts.mode as string;

    if (
      (SUMMARY_MODES as readonly string[]).includes(
        requestedMode,
      )
    ) {
      mode =
        requestedMode as SummaryMode;
    } else {
      notes.push(
        `unrecognized mode "${requestedMode}" — defaulted to "${DEFAULT_SUMMARY_MODE}"`,
      );
    }
  }

  // Resolve the document-level language once.
  //
  // For mixed Bitrix templates this remains Bitrix, but executable source
  // regions are subsequently assigned their own extraction language.
  const lang =
    opts.language &&
    opts.language !== "auto"
      ? resolveLanguage(opts.language)
      : sniffLanguage(source);

  const sourceRegions =
    segmentSource(
      source,
      lang,
    );

  const symbols: CodeSymbol[] = [];
  const dependencies: Dependency[] = [];

  // Extract independently inside each executable region.
  //
  // This is the critical mixed-template boundary:
  // PHP declaration rules never inspect JavaScript,
  // JavaScript declaration rules never inspect PHP,
  // and markup is never passed to executable extraction.
  let regionCounter = 0;

  for (const region of sourceRegions) {
    if (
      region.language === "markup"
    ) {
      continue;
    }

    let regionLang;

    if (
      region.language === "javascript"
    ) {
      // Existing TS definition covers JavaScript as well.
      regionLang = TS;
    } else if (
      region.language === "php"
    ) {
      // Preserve Bitrix-specific framework call extraction.
      regionLang =
        lang.id === "bitrix"
          ? BITRIX
          : PHP;
    } else {
      regionLang =
        resolveLanguage(
          region.language,
        );
    }

    const extraction =
      extract(
        source,
        regionLang,
        planFidelity(mode).sigMaxLen,
        {
          region,
          idPrefix:
            `${region.id}_${regionCounter++}_`,
        },
      );

    symbols.push(
      ...extraction.symbols,
    );

    for (
      const dep of
        extraction.dependencies
    ) {
      const exists =
        dependencies.some(
          (d) =>
            d.module ===
              dep.module &&
            JSON.stringify(
              d.names ?? [],
            ) ===
              JSON.stringify(
                dep.names ?? [],
              ),
        );

      if (!exists) {
        dependencies.push(dep);
      }
    }
  }

  // Derive meaningful executable source gaps that are not already owned by
  // declaration bodies. These become the source regions rendered by `full`.
  const editableRegions =
    deriveEditableRegions(
      source,
      sourceRegions,
      symbols,
    );

  const regions: CodeRegion[] = [
    ...sourceRegions,
    ...editableRegions,
  ];

  // Behavior and relationship analysis are language-aware through the
  // language/region information carried by each symbol.
  analyzeBehavior(
    source,
    symbols,
    dependencies,
  );

  const edges =
    relate(
      source,
      symbols,
    );

  if (
    symbols.length === 0 &&
    source.trim()
  ) {
    notes.push(
      "no declarations found — input may be an expression, data, or an unrecognized dialect",
    );
  }

  const summary: Summary = {
    language: lang.label,
    confidence: lang.confidence,
    symbols,
    regions,
    dependencies,
    edges,
    notes,
  };

  return {
    summary,
    text: render(
      summary,
      source,
      mode,
    ),
  };
}