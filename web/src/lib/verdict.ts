import type { Band, Verdict } from "./api";

/** Band → the word on the stamp. CLEAN white, RISKY outlined red, DANGER and RUGGED solid red. */
export const WORD: Record<Band, string> = { SAFE: "CLEAN", CAUTION: "RISKY", DANGER: "DANGER", RUGGED: "RUGGED" };

export const isHot = (v: Pick<Verdict, "verdict">) => v.verdict === "DANGER" || v.verdict === "RUGGED";

/** Records written before the structured judge lack some fields; fill them so one renderer serves every record. */
export const normalise = (raw: Verdict): Verdict => ({
  ...raw,
  headline: raw.headline ?? "", decisive: raw.decisive ?? "", action: raw.action ?? "",
  cleanSignals: raw.cleanSignals ?? [], whatWouldChange: raw.whatWouldChange ?? [], scorecard: raw.scorecard ?? [],
  advocate: raw.advocate ?? null, rebuttal: raw.rebuttal ?? null, timeline: raw.timeline ?? [],
  topReasons: raw.topReasons ?? [], vetoes: raw.vetoes ?? [], flags: raw.flags ?? [], findings: raw.findings ?? [],
  outcomes: raw.outcomes ?? [],
});
