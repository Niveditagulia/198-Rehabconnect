'use client';
import { useState } from 'react';
import {LogOut} from 'lucide-react';
export default function SignOutButton({className = 'logout-link',beforeSignOut}:{className?:string;beforeSignOut?:()=>Promise<boolean>}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  return <><button className={className} disabled={busy} onClick={async()=>{
    setBusy(true);setError('');
    try {
      if (beforeSignOut && !await beforeSignOut()) {
        setError('Session save failed. Review the live session before signing out.');
        setBusy(false);
        return;
      }
      const result=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});
      if (!result.ok) throw new Error('Sign out failed. Try again.');
      window.location.assign('/login');
    } catch {setError('Sign out failed. Try again.');setBusy(false);}
  }}><LogOut size={15}/>{busy?'Signing out…':'Sign out'}</button>{error&&<span role="alert">{error}</span>}</>;
}
