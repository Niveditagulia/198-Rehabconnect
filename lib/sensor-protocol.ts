export type Reading={sequence:number;acceleration:number|null;heartRate:number|null;movementValid:boolean;heartRateValid:boolean;timestamp:number};
export function parseReading(line:string,previous:Reading|null):Reading{
 const v=JSON.parse(line);
 if(!v||!Number.isSafeInteger(v.sequence)||v.sequence<0||typeof v.movementValid!=='boolean'||typeof v.heartRateValid!=='boolean'||!Number.isFinite(v.timestamp)||v.timestamp<0)throw new Error('Invalid sensor packet. Reading ignored.');
 if(previous&&v.sequence<=previous.sequence)throw new Error('Repeated or out-of-order packet ignored. Reconnect after restarting the board.');
 if(previous&&v.timestamp<previous.timestamp)throw new Error('Sensor clock reset. Reconnect the board before continuing.');
 if(v.movementValid&&(!Number.isFinite(v.acceleration)||v.acceleration<0||v.acceleration>200))throw new Error('Send movement acceleration in m/s² as acceleration. Reading ignored.');
 if(v.heartRateValid&&(!Number.isFinite(v.heartRate)||v.heartRate<=0||v.heartRate>300))throw new Error('Invalid heart-rate value. Reading ignored.');
 return{sequence:v.sequence,acceleration:v.movementValid?v.acceleration:null,heartRate:v.heartRateValid?v.heartRate:null,movementValid:v.movementValid,heartRateValid:v.heartRateValid,timestamp:v.timestamp};
}
export type ThresholdState={armed:boolean;lastCountAt:number};
export const freshThreshold=():ThresholdState=>({armed:false,lastCountAt:-Infinity});
// Count an upward crossing once; re-arm below 1 m/s², reject rapid noise.
// Input is gravity-compensated movement acceleration, not raw gravity magnitude.
export function thresholdStep(state:ThresholdState,reading:Reading,running:boolean):{state:ThresholdState;delta:number}{
 if(!running||!reading.movementValid||reading.acceleration===null)return{state:freshThreshold(),delta:0};
 if(reading.acceleration<1)return{state:{...state,armed:true},delta:0};
 if(reading.acceleration>=2&&state.armed){const count=reading.timestamp-state.lastCountAt>=500;return{state:{armed:false,lastCountAt:count?reading.timestamp:state.lastCountAt},delta:count?1:0}}
 return{state,delta:0};
}
