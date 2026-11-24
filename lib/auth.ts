import { randomBytes, scrypt as nodeScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { getDatabase } from './database';
export type Role = 'patient' | 'physiotherapist';
export type AuthUser = {userId: string; email: string; displayName: string; role: Role};
const scrypt = promisify(nodeScrypt);
const cookieName = 'rehabconnect_session';
const lifetime = 60 * 60 * 24 * 7;
function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('Set AUTH_SECRET to a random value of at least 32 characters.');
  return new TextEncoder().encode(value);
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, value] = stored.split(':');
  const hash = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(value, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export function validInvite(value: string) {
  const expected = process.env.THERAPIST_INVITE_CODE;
  return !!expected && timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(expected).digest());
}
export async function startSession(userId: string, role: Role) {
  const key = secret();
  const id = randomBytes(32).toString('hex');
  const db = await getDatabase();
  await db.prepare('INSERT INTO auth_sessions (id,account_id,expires_at) VALUES (?,?,?)').bind(id, userId, Date.now() + lifetime * 1000).run();
  const token = await new SignJWT({role}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setJti(id).setIssuedAt().setExpirationTime(`${lifetime}s`).setIssuer('rehabconnect').setAudience('rehabconnect').sign(key);
  (await cookies()).set(cookieName, token, {httpOnly:true, secure: process.env.NODE_ENV === 'production', sameSite:'lax', path:'/', maxAge:lifetime});
}
async function sessionPayload() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try { return (await jwtVerify(token, secret(), {algorithms:['HS256'], issuer:'rehabconnect', audience:'rehabconnect'})).payload; }
  catch { return null; }
}
export async function getUser(): Promise<AuthUser | null> {
  const payload = await sessionPayload();
  if (!payload?.sub || !payload.jti) return null;
  const db = await getDatabase();
  const user = await db.prepare(`SELECT a.id AS userId,a.email,a.role,p.name AS displayName FROM accounts a JOIN profiles p ON p.id=a.id JOIN auth_sessions s ON s.account_id=a.id WHERE s.id=? AND a.id=? AND s.expires_at>?`).bind(payload.jti, payload.sub, Date.now()).first<AuthUser>();
  return user?.role === payload.role ? user : null;
}
export async function endSession() {
  const payload = await sessionPayload();
  if (payload?.jti) {
    const db = await getDatabase();
    await db.prepare('DELETE FROM auth_sessions WHERE id=?').bind(payload.jti).run();
  }
  (await cookies()).delete(cookieName);
}
export async function rateLimit(email: string) {
  const db = await getDatabase();
  const key = createHash('sha256').update(email).digest('hex');
  const now = Date.now();
  const result = await db.prepare(`INSERT INTO auth_limits(key,count,reset_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN auth_limits.reset_at<? THEN 1 ELSE auth_limits.count+1 END,
      reset_at=CASE WHEN auth_limits.reset_at<? THEN excluded.reset_at ELSE auth_limits.reset_at END
    RETURNING count`).bind(key, now + 900000, now, now).first<{count:number}>();
  return !!result && result.count <= 20;
}
