import type {
  CodeSymbol,
  Dependency,
  SymbolBehavior,
} from "./model";
import {
  REGISTRY,
  resolveLanguage,
} from "./languages";
import { stripNoise, escapeRegExp } from "./strip";

// Enriches each symbol with cheap, defensible static facts drawn from its
// own source language and region.
export function analyzeBehavior(
  src: string,
  symbols: CodeSymbol[],
  deps: Dependency[],
): void {
  for (const s of symbols) {
    if (
      s.kind !== "function" &&
      s.kind !== "method" &&
      s.kind !== "call"
    ) {
      continue;
    }

    // `language` is the actual extraction definition, e.g. "bitrix" or
    // "typescript", rather than the document's dominant language.
    const lang =
      resolveLanguage(s.language) ??
      REGISTRY.find((l) => l.id === s.language);

    if (!lang) continue;

    const cleanLines = stripNoise(
      src,
      lang.comments,
    ).split("\n");

    const bodyStart =
      s.kind === "call"
        ? s.line - 1
        : s.line;

    const body = cleanLines
      .slice(
        Math.max(0, bodyStart),
        s.endLine,
      )
      .join("\n");

    if (!body.trim()) continue;

    const b = lang.behavior;

    const externals = new Set<string>();

    // Keep existing dependency semantics, but only use them as cheap name
    // probes. No general call extraction is introduced.
    for (const d of deps) {
      const leaf = d.module
        .split(/[\\/:.]/)
        .filter(Boolean)
        .pop();

      if (leaf) externals.add(leaf);

      for (const n of d.names ?? []) {
        externals.add(n);
      }
    }

    const test = (re?: RegExp) =>
      re ? re.test(body) : false;

    const hasReturnVal =
      b.returns
        ? b.returns.test(body)
        : false;

    const hasBareReturn =
      /\breturn\s*;?\s*$/m.test(body);

    const returns: SymbolBehavior["returns"] =
      hasReturnVal
        ? "value"
        : hasBareReturn
          ? "void"
          : "unknown";

    const calls: string[] = [];

    for (const name of externals) {
      if (
        new RegExp(
          `\\b${escapeRegExp(name)}\\s*\\(`,
        ).test(body)
      ) {
        calls.push(name);
      }
    }

    s.behavior = {
      async: test(b.async),
      recursive: new RegExp(
        `\\b${escapeRegExp(s.name)}\\s*\\(`,
      ).test(body),
      branches: test(b.branch),
      loops: test(b.loop),
      throws: test(b.throws),
      handlesErrors: test(b.handles),
      mutatesState: test(b.selfMember),
      returns,
      calls: calls.slice(0, 8),
    };
  }
}

export function behaviorLine(
  b: SymbolBehavior,
  level: 0 | 1 | 2,
): string {
  if (level === 0) return "";

  const parts: string[] = [];

  if (b.async) parts.push("async");
  if (b.recursive) parts.push("recursive");
  if (b.branches) parts.push("branches");
  if (b.loops) parts.push("iterates");
  if (b.throws) parts.push("may throw");
  if (b.handlesErrors) parts.push("handles errors");
  if (b.mutatesState) parts.push("mutates state");

  if (b.returns === "value") {
    parts.push("returns value");
  } else if (b.returns === "void") {
    parts.push("returns void");
  }

  if (level === 2 && b.calls.length) {
    parts.push(`calls ${b.calls.join(", ")}`);
  }

  return parts.join(", ");
}