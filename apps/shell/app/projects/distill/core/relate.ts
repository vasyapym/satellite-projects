import type {
  CodeSymbol,
  RefEdge,
} from "./model";
import {
  resolveLanguage,
} from "./languages";
import { superTypesOf } from "./extract";
import {
  stripNoise,
  escapeRegExp,
} from "./strip";

/**
 * Deliberately lossy name/reference graph.
 *
 * Mixed-language symbols are related only within their actual language.
 * This prevents a JavaScript `foo` from accidentally resolving to a PHP
 * `foo` solely because the whole document was detected as Bitrix.
 */
export function relate(
  src: string,
  symbols: CodeSymbol[],
): RefEdge[] {
  const edges: RefEdge[] = [];
  const seen = new Set<string>();

  const push = (e: RefEdge) => {
    const key =
      `${e.from}|${e.to}|${e.kind}`;

    if (
      e.from !== e.to &&
      !seen.has(key)
    ) {
      seen.add(key);
      edges.push(e);
    }
  };

  const byName = new Map<
    string,
    CodeSymbol[]
  >();

  for (const s of symbols) {
    const lang = resolveLanguage(s.language);

    if (lang.reserved?.has(s.name)) continue;

    const key = `${lang.id}::${s.name}`;
    const list = byName.get(key) ?? [];

    list.push(s);
    byName.set(key, list);
  }

  for (const s of symbols) {
    const lang = resolveLanguage(s.language);

    const {
      extends: ex,
      implements: im,
    } = superTypesOf(
      s.signature,
      lang,
    );

    const sourceKey =
      (name: string) =>
        `${lang.id}::${name}`;

    for (const t of ex) {
      for (
        const target of
          byName.get(sourceKey(t)) ?? []
      ) {
        push({
          from: s.id,
          to: target.id,
          kind: "extends",
        });
      }
    }

    for (const t of im) {
      for (
        const target of
          byName.get(sourceKey(t)) ?? []
      ) {
        push({
          from: s.id,
          to: target.id,
          kind: "implements",
        });
      }
    }
  }

  for (const s of symbols) {
    const lang = resolveLanguage(s.language);

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

    const hits = body.match(
      /[A-Za-z_$][\w$]*/g,
    );

    if (!hits) continue;

    for (const name of new Set(hits)) {
      const targets =
        byName.get(
          `${lang.id}::${name}`,
        );

      if (!targets?.length) continue;

      const called = new RegExp(
        `\\b${escapeRegExp(name)}\\s*\\(`,
      ).test(body);

      for (const target of targets) {
        push({
          from: s.id,
          to: target.id,
          kind: called
            ? "calls"
            : "references",
        });
      }
    }
  }

  return edges;
}