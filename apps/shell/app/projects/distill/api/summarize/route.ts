import { NextResponse } from "next/server";
import { summarize, SUMMARY_MODES, DEFAULT_SUMMARY_MODE } from "../../core";
import type { SummaryMode } from "../../core";

const MAX_INPUT = 200_000; // ~50k tokens: the DoS / size guard

export async function POST(req: Request) {
  let source = "";
  let language: string | undefined;
  let mode: SummaryMode = DEFAULT_SUMMARY_MODE;
  let unknownMode: string | undefined;

  try {
    const body = (await req.json()) as {
      source?: unknown; language?: unknown; mode?: unknown;
    };
    if (typeof body.source === "string") source = body.source;
    if (typeof body.language === "string") language = body.language;
    if (typeof body.mode === "string") {
      if ((SUMMARY_MODES as readonly string[]).includes(body.mode)) {
        mode = body.mode as SummaryMode;
      } else {
        unknownMode = body.mode; // honesty contract: record it, don't 400
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (source.length > MAX_INPUT) {
    return NextResponse.json(
      { error: `Input too large (${source.length} chars; limit ${MAX_INPUT}).` },
      { status: 413 },
    );
  }

  try {
    const { text, summary } = summarize(source, { language, mode });
    return NextResponse.json({
      text,
      language: summary.language,
      confidence: summary.confidence,
      symbolCount: summary.symbols.length,
      mode,                                   // echo resolved mode back to UI
      ...(unknownMode ? { unknownMode } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Summarization failed", detail: String(e) },
      { status: 500 },
    );
  }
}
