/**
 * ERP model code -> Stacker drawing names to try, best first. Worked out from loads that were
 * already stacked by hand (e.g. FMCMR8220 "car hauler 18+2 9900#" was stacked as "20' MED FB").
 * Drawings are named by overall length, so 18+2 is a 20'. A row in rs_model_map overrides this.
 */
export function profileNamesFor(code: string): string[] {
  const c = code.toUpperCase().trim();
  let m: RegExpMatchArray | null;
  const ft = (s: string) => String(parseInt(s, 10));

  // Max-ramp equipment trailers (18+3, 20+3) use the 17'+3' drawing.
  if (/^FM(EH|HD)(MR)?82\d\d(MR)?$/.test(c) && c.includes("MR")) return ["17'+3' Heavy FB"];
  // 7,000# car haulers. There is no 22' FB drawing, so those fall through to the MED one.
  if ((m = c.match(/^FMCR?82(\d\d)$/)) && !c.startsWith("FMCM")) return [`${ft(m[1])}' FB`, `${ft(m[1])}' MED FB`];
  // 9,900# car haulers and equipment trailers.
  if ((m = c.match(/^FM(CM|EM)R?82(\d\d)$/))) return [`${ft(m[2])}' MED FB`, `${ft(m[2])}' FB`];
  // 14,000# and up equipment trailers.
  if ((m = c.match(/^FM(EHR?|HDEC|HD)82(\d\d)$/))) return [`${ft(m[2])}' Heavy FB`, `${ft(m[2])}' MED FB`];
  if ((m = c.match(/^PT(H|E|HD|HDEC)(20|22)S?$/))) return [`${m[2]}' Partial Tilt`];
  if (/^(HD14|HDM14|HDWS14)$/.test(c)) return ["82x14 Tele Dump"];
  if (c === "HDWS612") return ["72x12 Dump"];
  if ((m = c.match(/^DOG\d\d(\d\d)5/))) return [`${ft(m[1])}+5 Gooseneck`, `${ft(m[1])}+5 Deckover`];
  if ((m = c.match(/^DOP\d\d(\d\d)5/))) return [`${ft(m[1])}+5 Deckover`];
  if (/^FIWS/.test(c)) return ['8" I-Beam Work Series 182'];
  if ((m = c.match(/^RS[PM]?(76|82)(\d\d)/))) return [`${ft(m[2])}' single utility`];
  if ((m = c.match(/^SSTM?(76|82)(\d\d)/))) return [`${ft(m[2])}' Stealth`];
  if ((m = c.match(/^TSTM?(76|82)(\d\d)/))) return [`${ft(m[2])}' Stealth TA`];
  if ((m = c.match(/^T(D|DP|DPM|DM|E)(76|82)(\d\d)/))) return [`${ft(m[3])}' TA Utility`];
  return [];
}
