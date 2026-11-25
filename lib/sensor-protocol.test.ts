import assert from 'node:assert/strict';
import {advanceSets, creditedSets, resumePlan} from './set-progress.ts';
import {counterDelta, lineReader, parseReading} from './sensor-protocol.ts';
const base = {v:1,type:'tracker',link:'test',setId:1,setReps:0,bootReps:0,seq:1,state:'running'} as const;
const five = {...base,seq:3,setReps:5,bootReps:5,state:'paused'} as const;
const restart = {...base,seq:4,setId:2,bootReps:5};
const three = {...restart,seq:6,setReps:3,bootReps:8};
let previous = base as ReturnType<typeof parseReading>, total = 0;
const receive = lineReader(line => {
  const next = parseReading(line);
  const delta = counterDelta(previous,next);
  if (delta !== null) {total += delta; previous = next;}
});
const frames = [five,five,restart,three].map(p=>JSON.stringify(p)+'\r\n').join('');
receive(frames.slice(0,14)); receive(frames.slice(14));
assert.equal(total,8);
assert.equal(previous.setReps,3);
let sets = {repsPerSet:8, counts:[0]};
for (let rep = 1; rep <= 32; rep++) {
  sets = advanceSets(sets, 1, 0, rep);
  assert.equal(creditedSets(sets, 32), rep >= 8 ? 1 : 0);
}
for (let set = 2; set <= 4; set++) {
  sets = advanceSets(sets, 0, 1, 0);
  assert.equal(creditedSets(sets, 32), set - 1);
  sets = advanceSets(sets, 8, 0, 8);
}
assert.equal(creditedSets(sets, 32), 4);
assert.deepEqual(advanceSets({repsPerSet:8, counts:[7]}, 3, 1, 2).counts,[8,2]);
assert.deepEqual(advanceSets({repsPerSet:8, counts:[7]}, 10, 2, 2).counts,[7,2]);
assert.equal(counterDelta({...base,setReps:4,bootReps:4},five),1);
assert.equal(counterDelta(three,{...base,seq:7}),null);
assert.equal(counterDelta(three,{...three,seq:7,link:'new'}),null);
assert.throws(()=>parseReading('change:0.31,trigger:2.00,reps:0'),/Original tracker/);
assert.throws(()=>parseReading('{"movementValid":false}'),/template/);
assert.throws(()=>parseReading(JSON.stringify({...base,setReps:2})));
// Resume after a lost baseline (RESET, unplug, reload, stale stream).
const pkt = {link:'a',setId:1,setReps:5,bootReps:5};
const fivePlan = {repsPerSet:8, counts:[5]};
assert.deepEqual(resumePlan(fivePlan, pkt, pkt), {ok:true, plan:fivePlan});                      // same link, set and count: continue
assert.equal(resumePlan(fivePlan, null, pkt).ok, false);                                       // reload: tracker mid-set is refused
assert.equal(resumePlan(fivePlan, pkt, {...pkt, link:'b', setReps:3, bootReps:3}).ok, false);  // RESET then reps: refused
assert.equal(resumePlan(fivePlan, pkt, {...pkt, bootReps:7, setReps:7}).ok, false);            // reps missed while stale: refused
assert.deepEqual(resumePlan(fivePlan, pkt, {link:'b',setId:1,setReps:0,bootReps:0}), {ok:true, plan:{repsPerSet:8, counts:[5,0]}});
assert.deepEqual(resumePlan(fivePlan, null, {link:'b',setId:2,setReps:0,bootReps:5}), {ok:true, plan:{repsPerSet:8, counts:[5,0]}});
assert.deepEqual(resumePlan({repsPerSet:8,counts:[0]}, null, {link:'b',setId:1,setReps:0,bootReps:0}), {ok:true, plan:{repsPerSet:8,counts:[0]}});
assert.deepEqual(resumePlan(null, null, pkt), {ok:true, plan:null});                       // historical total-only session
// RESET case from the review: 5 reps, RESET, fresh set, 3 reps -> [5,3], no credit.
let after = (resumePlan(fivePlan, pkt, {link:'b',setId:1,setReps:0,bootReps:0}) as {plan:{repsPerSet:number;counts:number[]}}).plan;
after = advanceSets(after, 3, 0, 3);
assert.deepEqual(after.counts, [5,3]); assert.equal(creditedSets(after, 32), 0);
