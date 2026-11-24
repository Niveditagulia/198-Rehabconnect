import assert from 'node:assert/strict';
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
assert.equal(counterDelta({...base,setReps:4,bootReps:4},five),1);
assert.equal(counterDelta(three,{...base,seq:7}),null);
assert.equal(counterDelta(three,{...three,seq:7,link:'new'}),null);
assert.throws(()=>parseReading('change:0.31,trigger:2.00,reps:0'),/Original tracker/);
assert.throws(()=>parseReading('{"movementValid":false}'),/template/);
assert.throws(()=>parseReading(JSON.stringify({...base,setReps:2})));
