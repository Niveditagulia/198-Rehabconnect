'use client';
import {useEffect,useRef,useState} from 'react';
import {parseReading,type Reading} from './sensor-protocol';
type Port={open:(o:{baudRate:number})=>Promise<void>;close:()=>Promise<void>;setSignals?:(s:{dataTerminalReady:boolean})=>Promise<void>;readable:ReadableStream<Uint8Array>|null};
export function useUsbSensor(onReading:(r:Reading,previous:Reading|null)=>void){
 const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reading,setReading]=useState<Reading|null>(null),[lastSeen,setLastSeen]=useState(0),[stale,setStale]=useState(true);
 const port=useRef<Port|null>(null),reader=useRef<ReadableStreamDefaultReader<Uint8Array>|null>(null),previous=useRef<Reading|null>(null),callback=useRef(onReading),stamp=useRef(0),stopped=useRef(false);callback.current=onReading;
 useEffect(()=>{const t=setInterval(()=>setStale(Date.now()-stamp.current>3500),500);return()=>{clearInterval(t);stopped.current=true;void reader.current?.cancel()}},[]);
 async function disconnect(){stopped.current=true;await reader.current?.cancel();setConnected(false);setStale(true);stamp.current=0;setReading(null)}
 async function connect(){
  const serial=(navigator as Navigator & {serial?:{requestPort:()=>Promise<Port>}}).serial;
  if(!serial){setError('USB serial is unavailable here. Open this site in desktop Chrome or Edge using HTTPS or localhost.');return}
  setBusy(true);setError('');previous.current=null;setReading(null);stamp.current=0;setStale(true);stopped.current=false;
  try{const p=await serial.requestPort();port.current=p;await p.open({baudRate:115200});await p.setSignals?.({dataTerminalReady:true});setConnected(true);setBusy(false);
   if(!p.readable)throw new Error('The serial device is not readable.');const rd=p.readable.getReader();reader.current=rd;const decoder=new TextDecoder();let buffer='';
   try{while(!stopped.current){const {value,done}=await rd.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>65536){buffer='';setError('Oversized serial message ignored. Send one JSON object per line.');continue}let pos;while((pos=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,pos).trim();buffer=buffer.slice(pos+1);if(!line)continue;try{const next=parseReading(line,previous.current);callback.current(next,Date.now()-stamp.current>3500?null:previous.current);previous.current=next;setReading(next);stamp.current=Date.now();setLastSeen(stamp.current);setStale(false);setError('')}catch(err){setError(err instanceof Error?err.message:'Invalid reading ignored.')}}}}
   finally{rd.releaseLock();reader.current=null}
  }catch(err){setError(err instanceof Error?err.message:'Unable to connect to the Arduino.')}finally{setBusy(false);setConnected(false);setStale(true);stamp.current=0;try{await port.current?.close()}catch{}port.current=null}
 }
 return {connected,busy,error,reading,lastSeen,stale,connect,disconnect};
}
