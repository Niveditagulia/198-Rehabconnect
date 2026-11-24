export type Reading = {
  v: 1; type: "tracker"; link: string; seq: number; setId: number;
  setReps: number; bootReps: number; state: "running" | "paused" | "calibrating" | "fault";
};

export function parseReading(line: string): Reading {
  if (line.startsWith("change:") || line.startsWith("Baseline magnitude"))
    throw new Error("Original tracker firmware detected. Upload the RehabConnect tracker sketch.");
  const p = JSON.parse(line);
  if (p?.movementValid !== undefined)
    throw new Error("Acceleration template detected. Upload the RehabConnect tracker sketch.");
  if (p?.v !== 1 || p.type !== "tracker" || typeof p.link !== "string" ||
      !["running", "paused", "calibrating", "fault"].includes(p.state) ||
      ![p.seq, p.setId, p.setReps, p.bootReps].every(n => Number.isSafeInteger(n) && n >= 0) ||
      p.setReps > p.bootReps)
    throw new Error("Unrecognized tracker packet. Check the firmware version.");
  return p;
}

export function counterDelta(previous: Reading, next: Reading): number | null {
  if (previous.link !== next.link || next.seq <= previous.seq ||
      next.bootReps < previous.bootReps || next.setId < previous.setId ||
      (next.setId === previous.setId && next.setReps < previous.setReps)) return null;
  return next.bootReps - previous.bootReps;
}

export function lineReader(accept: (line: string) => void) {
  let tail = "", overflow = false;
  return (chunk: string) => {
    for (const c of chunk) {
      if (c === "\n") {
        if (!overflow && tail.trim()) accept(tail.trim());
        tail = ""; overflow = false;
      } else if (tail.length < 4096) tail += c;
      else overflow = true;
    }
  };
}
