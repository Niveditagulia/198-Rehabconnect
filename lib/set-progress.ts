export type SetPlan = { repsPerSet: number; counts: number[] };

export function creditedSets(plan: SetPlan, totalTarget: number) {
  const full = plan.counts.filter(n => n >= plan.repsPerSet).length;
  return Math.min(full, totalTarget / plan.repsPerSet);
}

// Only a new firmware setId opens another set. A heartbeat or a rep never does.
export function advanceSets(plan: SetPlan, delta: number, setJump: number, currentSetReps: number): SetPlan {
  if (!delta && !setJump) return plan;
  const counts = [...plan.counts];
  const last = counts.length - 1;
  if (setJump === 0) counts[last] += delta;
  else {
    const inNewSet = Math.min(delta, currentSetReps);
    // With skipped set IDs, the missing reps have no known set allocation.
    if (setJump === 1) counts[last] += delta - inNewSet;
    if (counts[last]) counts.push(inNewSet);
    else counts[last] = inNewSet;
  }
  return { ...plan, counts };
}

type Packet = { link: string; setId: number; setReps: number; bootReps: number };
export const FRESH_SET_MESSAGE =
  "The tracker shows reps from before this session. Press black to pause, press it again and hold still, then continue when the tracker shows 0.";

// Decides how tracking resumes after the website lost its baseline (stale stream, RESET, unplug, reload).
// The previous web set continues only when the same connection, hardware set and boot count prove that
// no reps were missed. Otherwise the tracker must be on a fresh hardware set (0 reps), and the website
// opens a new set, so a set credit can never combine reps from two hardware sets and the OLED matches.
export function resumePlan(plan: SetPlan | null, prior: Packet | null, packet: Packet):
  { ok: true; plan: SetPlan | null } | { ok: false; reason: string } {
  if (!plan) return { ok: true, plan };
  if (prior && prior.link === packet.link && prior.setId === packet.setId && prior.bootReps === packet.bootReps)
    return { ok: true, plan };
  if (packet.setReps !== 0) return { ok: false, reason: FRESH_SET_MESSAGE };
  return { ok: true, plan: advanceSets(plan, 0, 1, 0) };
}
