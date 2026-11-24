import {strict as assert} from 'node:assert';
import {parseReading,thresholdStep,freshThreshold,type Reading} from './sensor-protocol.ts';
const base={sequence:1,timestamp:100,acceleration:0,heartRate:80,movementValid:true,heartRateValid:true};
const a=parseReading(JSON.stringify(base),null);
assert.throws(()=>parseReading(JSON.stringify(base),a),/Repeated/);
assert.throws(()=>parseReading(JSON.stringify({...base,sequence:2,heartRate:-3}),a),/heart-rate/);
assert.throws(()=>parseReading(JSON.stringify({...base,sequence:2,timestamp:0}),a),/clock reset/);
assert.throws(()=>parseReading(JSON.stringify({...base,acceleration:null}),null),/acceleration/);
assert.throws(()=>parseReading('{invalid',a));
let state=freshThreshold();let time=0,total=0;
function tick(acceleration:number,running=true,valid=true){time+=200;const reading:Reading={...base,timestamp:time,sequence:time,acceleration,movementValid:valid};const result=thresholdStep(state,reading,running);state=result.state;total+=result.delta;return result.delta}
assert.equal(tick(2.5),0);assert.equal(tick(0),0);assert.equal(tick(1.99),0);assert.equal(tick(2),1);
assert.equal(tick(3),0);assert.equal(tick(3),0);assert.equal(tick(1.9),0);assert.equal(tick(2.1),0);
tick(.5);assert.equal(tick(2),1);
tick(.5);assert.equal(tick(2),0); // 400ms noise rejected
assert.equal(total,2);
tick(.5);tick(2,false);assert.equal(tick(2),0);tick(.5);assert.equal(tick(2),1);
tick(.5);tick(2,true,false);assert.equal(tick(2),0);
assert.equal(parseReading(JSON.stringify({...base,movementValid:false,heartRateValid:false,acceleration:null,heartRate:null}),null).heartRate,null);
console.log('PASS: stationary input, exact 2 m/s² crossing, held-high values, hysteresis, debounce, pause/resume, invalid signals, duplicate packets and sensor reset.');
