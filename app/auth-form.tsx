'use client';
import { useState } from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
export default function AuthForm({register = false}: {register?: boolean}) {
  const [role,setRole] = useState('patient');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  return <main className="auth-page">
    <section className="auth-story">
      <a className="brand" href="/login"><span className="brand-icon"><Activity size={24}/></span>rehab<span>connect</span></a>
      <span className="eyebrow">CARE THAT STAYS CONNECTED</span>
      <h1>Your recovery.<br/>A shared commitment.</h1>
      <p>Equipment-based exercise tracking, a plan made for you, and the people supporting your progress.</p>
      <div className="auth-visual"><div className="auth-ring"><Activity size={60}/></div></div>
      <small>ECE198 Group 2 · Physiotherapy monitoring</small>
    </section>
    <section className="auth-form">
      <span className="auth-kicker">WELCOME TO REHABCONNECT</span>
      <h2>{register ? 'Create your account.' : 'Log in to your workspace.'}</h2>
      <p>Select your account type and enter your email and password.</p>
      <form className="profile-form" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:register?'register':'login',role,email:form.get('email'),password:form.get('password'),...(register?{name:form.get('name'),inviteCode:form.get('inviteCode') || ''}:{})})});
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          window.location.assign(result.redirect);
        } catch(error) {setError(error instanceof Error?error.message:'Unable to sign in.');setBusy(false);}
      }}>
        <label>Account type<select name="role" value={role} onChange={event=>setRole(event.target.value)}><option value="patient">Patient</option><option value="physiotherapist">Physiotherapist</option></select></label>
        {register && <label>Your name<input name="name" autoComplete="name" minLength={2} maxLength={100} required/></label>}
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required/></label>
        <label>Password<input name="password" type="password" autoComplete={register?'new-password':'current-password'} minLength={12} maxLength={128} required/></label>
        {register && <p className="muted">Use at least 12 characters. Your account type is fixed after registration.</p>}
        {register && role === 'physiotherapist' && <label>Physiotherapist invitation code<input name="inviteCode" type="password" autoComplete="off" required/><small>Ask the site owner for your invitation code.</small></label>}
        {error && <div className="warning" role="alert">{error}</div>}
        <button className="primary full" disabled={busy}>{busy?'Please wait…':register?`Create ${role} account`:`Log in as ${role}`}</button>
      </form>
      <p className="register-link">{register?'Already registered?':'New to RehabConnect?'} <a href={register?'/login':'/register'}>{register?'Log in':'Create an account'}</a></p>
      <div className="auth-security"><ShieldCheck size={20}/><p>Your private workspace is protected by your account role. Physiotherapist registration requires an invitation.</p></div>
    </section>
  </main>;
}
