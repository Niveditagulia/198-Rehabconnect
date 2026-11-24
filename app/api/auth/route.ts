import { z } from 'zod';
import { sameOrigin } from '../../../lib/request-origin';
import { getDatabase } from '../../../lib/database';
import { endSession, getUser, hashPassword, rateLimit, startSession, validInvite, verifyPassword } from '../../../lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const inputSchema = z.object({
  action: z.enum(['login','register']),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(12, 'Use a password with at least 12 characters.').max(128),
  role: z.enum(['patient','physiotherapist']),
  name: z.string().trim().min(2).max(100).optional(),
  inviteCode: z.string().max(200).optional(),
});
const json = (body: unknown, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
export async function GET() {
  const user = await getUser();
  return json(user ? {email:user.email, role:user.role} : {error:'Please log in.'}, user ? 200 : 401);
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({error:'Request origin is not allowed.'},403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({error:'Use JSON.'},415);
  try {
    const raw = await request.text();
    if (raw.length > 8192) return json({error:'Request too large.'},413);
    const input = JSON.parse(raw);
    if (input.action === 'logout') { await endSession(); return json({redirect:'/login'}); }
    const data = inputSchema.parse(input);
    if (!await rateLimit(data.email)) return json({error:'Too many attempts. Please try again in 15 minutes.'},429);
    const db = await getDatabase();
    if (data.action === 'register') {
      if (!data.name) return json({error:'Enter your name.'},400);
      if (data.role === 'physiotherapist' && !validInvite(data.inviteCode || '')) return json({error:'A valid physiotherapist invitation code is required.'},403);
      if (await db.prepare('SELECT id FROM accounts WHERE email=? AND role=?').bind(data.email,data.role).first()) return json({error:'This account already exists. Please log in.'},409);
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(data.password);
      try {
        await db.batch([
          db.prepare('INSERT INTO profiles(id,name,email,role,care_code,created_at) VALUES (?,?,?,?,?,?)').bind(id,data.name,data.email,data.role,data.role === 'physiotherapist' ? crypto.randomUUID().replaceAll('-','') : null,Date.now()),
          db.prepare('INSERT INTO accounts(id,email,role,password_hash) VALUES (?,?,?,?)').bind(id,data.email,data.role,passwordHash),
        ]);
      } catch(error) {
        if ((error as {code?: string})?.code === '23505' || String(error).includes('UNIQUE')) {
          return json({error:'This account already exists. Please log in.'},409);
        }
        throw error;
      }
      await startSession(id,data.role);
    } else {
      const account = await db.prepare('SELECT id,password_hash FROM accounts WHERE email=? AND role=?').bind(data.email,data.role).first<{id:string;password_hash:string}>();
      const stored = account?.password_hash || `00000000000000000000000000000000:${'00'.repeat(64)}`;
      const valid = await verifyPassword(data.password,stored);
      if (!account || !valid) return json({error:'Email, password, or account type is incorrect.'},401);
      await startSession(account.id,data.role);
    }
    return json({redirect:`/${data.role}`}, data.action === 'register' ? 201 : 200);
  } catch(error) {
    if (error instanceof z.ZodError) return json({error:error.issues[0]?.message || 'Invalid details.'},400);
    if (error instanceof SyntaxError) return json({error:'Invalid request.'},400);
    console.error('Authentication failed:', error instanceof Error ? error.message : 'unknown');
    return json({error:'Unable to sign in. Check the server database and authentication configuration.'},503);
  }
}
