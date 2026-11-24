'use client';
import {useEffect,useRef,useState} from 'react';
import {counterDelta,lineReader,parseReading,type Reading} from './sensor-protocol';

type Port = {
  open(options: {baudRate: number}): Promise<void>;
  close(): Promise<void>;
  setSignals?(options: {dataTerminalReady: boolean}): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};
const timeout = 3500;

export function useUsbSensor(onReading: (p: Reading) => void, onLoss: () => void) {
  const [connected,setConnected] = useState(false), [busy,setBusy] = useState(false);
  const [error,setError] = useState(''), [reading,setReading] = useState<Reading|null>(null);
  const [lastSeen,setLastSeen] = useState(0), [stale,setStale] = useState(true);
  const latest = useRef<Reading|null>(null), stamp = useRef(0);
  const active = useRef(false), generation = useRef(0);
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array>|null>(null);
  const callbacks = useRef({onReading,onLoss});
  callbacks.current = {onReading,onLoss};

  function invalidate() {
    if (latest.current) callbacks.current.onLoss();
    latest.current = null; stamp.current = 0;
    setStale(true); setReading(null);
  }
  useEffect(() => {
    const timer = setInterval(() => {
      if (stamp.current && Date.now()-stamp.current > timeout) invalidate();
    },250);
    return () => { clearInterval(timer); generation.current++; void reader.current?.cancel().catch(()=>{}); };
  },[]);
  async function disconnect() {
    generation.current++; invalidate(); setBusy(true);
    await reader.current?.cancel().catch(()=>{});
  }
  async function connect() {
    const serial = (navigator as Navigator & {serial?: {requestPort(): Promise<Port>}}).serial;
    if (!serial) {setError('Open the site in desktop Chrome or Edge over HTTPS to use USB.'); return;}
    if (active.current) return;
    active.current = true;
    const id = ++generation.current;
    let port: Port|undefined, rd: ReadableStreamDefaultReader<Uint8Array>|undefined;
    let writer: WritableStreamDefaultWriter<Uint8Array>|undefined;
    try {
      setBusy(true); setError(''); invalidate(); setLastSeen(0);
      port = await serial.requestPort();
      await port.open({baudRate:115200});
      await port.setSignals?.({dataTerminalReady:true});
      if (id !== generation.current) return;
      rd = port.readable.getReader(); reader.current = rd;
      writer = port.writable.getWriter();
      let link = crypto.randomUUID(), helloPending = false, lastHello = 0;
      const hello = () => {
        if (helloPending) return;
        lastHello = Date.now(); helloPending = true;
        void writer!.write(new TextEncoder().encode('HELLO '+link+'\n'))
          .catch(()=>{if(id===generation.current) setError('USB handshake failed. Reconnect the tracker.');})
          .finally(()=>{helloPending=false;});
      };
      setConnected(true); setBusy(false); hello();
      const decode = new TextDecoder();
      const consume = lineReader(line => {
        try {
          const p = parseReading(line);
          if (p.link !== link) {
            if (latest.current) { invalidate(); link = crypto.randomUUID(); }
            if (Date.now()-lastHello >= 400) hello();
            return;
          }
          if (stamp.current && Date.now()-stamp.current > timeout) invalidate();
          const prev = latest.current;
          if (prev && p.seq <= prev.seq) return;
          if ((prev && counterDelta(prev,p) === null) || p.state === 'fault') invalidate();
          if (p.state === 'fault') {setError('Tracker fault. Check the OLED connection and restart the board.'); return;}
          latest.current = p; stamp.current = Date.now();
          callbacks.current.onReading(p); setReading(p); setLastSeen(stamp.current); setStale(false); setError('');
        } catch(e) {setError((e as Error).message);}
      });
      while(id === generation.current) {
        const {value,done} = await rd.read();
        if(done || id !== generation.current) break;
        consume(decode.decode(value,{stream:true}));
      }
    } catch(e) {
      setError((e as Error).name === 'NotFoundError' ? 'Select the Arduino port in the USB chooser to connect.' : (e as Error).message);
    } finally {
      invalidate(); rd?.releaseLock(); writer?.releaseLock(); reader.current=null;
      try {await port?.close();} catch {}
      active.current=false; setBusy(false); setConnected(false);
    }
  }
  return {connected,busy,error,reading,lastSeen,stale,connect,disconnect,
    snapshot: () => Date.now()-stamp.current <= timeout ? latest.current : null};
}
