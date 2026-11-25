import { creditedSets } from "../../../lib/set-progress";
import { getDatabase, type Database } from "../../../lib/database";
import { getUser } from "../../../lib/auth";
import { sameOrigin } from "../../../lib/request-origin";
import { z } from "zod";
import type {
  Profile,
  Prescription,
  ExerciseSession,
} from "../../../lib/models";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const profileCols =
  `id,name,email,role,care_code AS "careCode",therapist_id AS "therapistId",created_at AS "createdAt"`;
const prescriptionCols =
  `id,patient_id AS "patientId",therapist_id AS "therapistId",name,instructions,reps,sets,minutes,active,created_at AS "createdAt"`;
const sessionCols =
  `id,patient_id AS "patientId",prescription_id AS "prescriptionId",exercise,instructions,target,set_plan AS "setPlan",reps,seconds,status,started_at AS "startedAt",updated_at AS "updatedAt",finished_at AS "finishedAt",heart,connection,revision`;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
type StoredSession = Omit<ExerciseSession, "setPlan" | "heart"> & { setPlan: string | null; heart: string };
const parseSession = (
  s: StoredSession,
): ExerciseSession => ({ ...s, setPlan: s.setPlan ? JSON.parse(s.setPlan) : null, heart: JSON.parse(s.heart) });
type AccountRole = "patient" | "physiotherapist";
const roleHeader = "x-rehabconnect-role";
function requestedRole(request: Request): AccountRole {
  const value = request.headers.get(roleHeader) ?? "patient";
  if (value === "patient" || value === "physiotherapist") return value;
  throw new HttpError(400, "Choose a valid RehabConnect workspace.");
}
function roleProfileIds(userId: string, role: AccountRole) {
  return role === "patient"
    ? ([userId, `${userId}:patient`] as const)
    : ([`${userId}:physiotherapist`, userId] as const);
}
async function context(request: Request) {
  const user = await getUser();
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  const db = await getDatabase();
  const role = requestedRole(request);
  if (role !== user.role) throw new HttpError(403, "This account cannot access that workspace.");
  const [preferredId, fallbackId] = roleProfileIds(user.userId, role);
  const profile = await db
    .prepare(
      `SELECT ${profileCols} FROM profiles WHERE role=? AND id IN (?,?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`,
    )
    .bind(role, preferredId, fallbackId, preferredId)
    .first<Profile>();
  return { user, db, profile, role };
}
function handleError(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json({ error: error.issues[0]?.message || "Invalid input." }, 400);
  console.error(
    "Application request failed",
    error instanceof Error ? `${error.name}: ${error.message}` : "Unknown",
  );
  return json(
    { error: "Your request could not be saved or loaded. Please retry." },
    500,
  );
}
async function assigned(db: Database, clinician: string, patient: string) {
  const p = await db
    .prepare("SELECT id FROM profiles WHERE id=? AND role=? AND therapist_id=?")
    .bind(patient, "patient", clinician)
    .first();
  if (!p)
    throw new HttpError(403, "This patient is not assigned to your account.");
}
export async function GET(request: Request) {
  try {
    const { user, db, profile, role } = await context(request);
    const base = {
      profile,
      identity: { name: user.displayName, email: user.email },
      activeRole: role,
      patients: [],
      therapist: null,
      prescriptions: [],
      sessions: [],
    };
    if (!profile) return json(base);
    const condition =
      profile.role === "patient"
        ? "patient_id=?"
        : "patient_id IN (SELECT id FROM profiles WHERE therapist_id=?)";
    const [patients, prescriptions, sessions, therapist] = await Promise.all([
      profile.role === "physiotherapist"
        ? db
            .prepare(
              `SELECT ${profileCols} FROM profiles WHERE therapist_id=? AND role='patient' ORDER BY name`,
            )
            .bind(profile.id)
            .all<Profile>()
        : Promise.resolve({ results: [] }),
      db
        .prepare(
          `SELECT ${prescriptionCols} FROM prescriptions WHERE ${condition} ORDER BY created_at DESC`,
        )
        .bind(profile.id)
        .all<Prescription>(),
      db
        .prepare(
          `SELECT ${sessionCols} FROM exercise_sessions WHERE ${condition} ORDER BY started_at DESC LIMIT 1000`,
        )
        .bind(profile.id)
        .all<StoredSession>(),
      profile.therapistId
        ? db
            .prepare("SELECT id,name,email FROM profiles WHERE id=?")
            .bind(profile.therapistId)
            .first()
        : Promise.resolve(null),
    ]);
    return json({
      ...base,
      patients: patients.results,
      prescriptions: prescriptions.results,
      sessions: sessions.results.map(parseSession),
      therapist,
    });
  } catch (error) {
    return handleError(error);
  }
}
const name = z
  .string()
  .trim()
  .min(2, "Enter at least two characters.")
  .max(100);
const uuid = z.string().uuid();
const prescriptionInput = z.object({
  patientId: z.string().min(1).max(200),
  name: z.string().trim().min(2).max(150),
  instructions: z.string().trim().min(10).max(3000),
  reps: z.number().int().min(1).max(200),
  sets: z.number().int().min(1).max(20),
  minutes: z.number().int().min(1).max(120),
});
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      throw new HttpError(403, "Request origin is not allowed.");
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new HttpError(415, "Use JSON for this request.");
    const raw = await request.text();
    if (raw.length > 300000)
      throw new HttpError(413, "Session payload is too large.");
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid JSON request.");
    }
    const { user, db, profile, role } = await context(request);
    const action = input.action;
    if (action === "register") {
      throw new HttpError(403, "Use the registration page to create an account.");
    }
    if (!profile) throw new HttpError(403, "Complete account setup first.");
    if (action === "profile") {
      const data = z.object({ name }).parse(input);
      await db
        .prepare("UPDATE profiles SET name=? WHERE id=?")
        .bind(data.name, profile.id)
        .run();
      return json({ ok: true });
    }
    if (action === "link-preview" || action === "link") {
      if (profile.role !== "patient")
        throw new HttpError(
          403,
          "Only patients can link to a physiotherapist.",
        );
      if (profile.therapistId)
        throw new HttpError(
          409,
          "You are already connected to a physiotherapist.",
        );
      const code = z
        .string()
        .regex(
          /^[a-f0-9]{32}$/,
          "Enter the complete care code from your physiotherapist.",
        )
        .parse(input.code);
      const therapist = await db
        .prepare(
          "SELECT id,name,email FROM profiles WHERE care_code=? AND role='physiotherapist'",
        )
        .bind(code)
        .first<{ id: string; name: string; email: string }>();
      if (!therapist)
        throw new HttpError(
          404,
          "Care code not found. Check it with your physiotherapist.",
        );
      if (action === "link-preview") return json({ therapist });
      if (input.confirm !== true)
        throw new HttpError(
          400,
          "Confirm consent to share your exercise records.",
        );
      await db
        .prepare(
          "UPDATE profiles SET therapist_id=? WHERE id=? AND therapist_id IS NULL",
        )
        .bind(therapist.id, profile.id)
        .run();
      return json({ ok: true });
    }
    if (action === "unlink") {
      if (profile.role !== "patient")
        throw new HttpError(
          403,
          "Only patients can disconnect their care relationship.",
        );
      const open = await db
        .prepare(
          "SELECT id FROM exercise_sessions WHERE patient_id=? AND status IN ('active','paused')",
        )
        .bind(profile.id)
        .first();
      if (open)
        throw new HttpError(
          409,
          "Finish your current session before disconnecting.",
        );
      await db.batch([
        db
          .prepare("UPDATE profiles SET therapist_id=NULL WHERE id=?")
          .bind(profile.id),
        db
          .prepare("UPDATE prescriptions SET active=0 WHERE patient_id=?")
          .bind(profile.id),
      ]);
      return json({ ok: true });
    }
    if (
      action === "prescribe" ||
      action === "update-prescription" ||
      action === "archive-prescription"
    ) {
      if (profile.role !== "physiotherapist")
        throw new HttpError(
          403,
          "Only physiotherapists can change prescriptions.",
        );
      if (action === "archive-prescription") {
        const id = uuid.parse(input.id);
        const p = await db
          .prepare(
            `SELECT patient_id AS "patientId",therapist_id AS "therapistId" FROM prescriptions WHERE id=?`,
          )
          .bind(id)
          .first<Prescription>();
        if (!p || p.therapistId !== profile.id)
          throw new HttpError(404, "Prescription not found.");
        await assigned(db, profile.id, p.patientId);
        await db
          .prepare("UPDATE prescriptions SET active=0 WHERE id=?")
          .bind(id)
          .run();
        return json({ ok: true });
      }
      const data = prescriptionInput.parse(input);
      await assigned(db, profile.id, data.patientId);
      if (action === "update-prescription") {
        const id = uuid.parse(input.id);
        const p = await db
          .prepare(
            "SELECT id FROM prescriptions WHERE id=? AND therapist_id=? AND patient_id=? AND active=1",
          )
          .bind(id, profile.id, data.patientId)
          .first();
        if (!p) throw new HttpError(404, "Active prescription not found.");
        await db
          .prepare(
            "UPDATE prescriptions SET name=?,instructions=?,reps=?,sets=?,minutes=? WHERE id=?",
          )
          .bind(
            data.name,
            data.instructions,
            data.reps,
            data.sets,
            data.minutes,
            id,
          )
          .run();
      } else
        await db
          .prepare(
            "INSERT INTO prescriptions (id,patient_id,therapist_id,name,instructions,reps,sets,minutes,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            data.patientId,
            profile.id,
            data.name,
            data.instructions,
            data.reps,
            data.sets,
            data.minutes,
            Date.now(),
          )
          .run();
      return json({ ok: true });
    }
    if (action === "start") {
      if (profile.role !== "patient")
        throw new HttpError(403, "Only patients can start their own sessions.");
      const id = uuid.parse(input.id),
        prescriptionId = uuid.parse(input.prescriptionId);
      const existing = await db
        .prepare(
          `SELECT ${sessionCols} FROM exercise_sessions WHERE id=? AND patient_id=?`,
        )
        .bind(id, profile.id)
        .first<StoredSession>();
      if (existing) return json({ session: parseSession(existing) });
      const open = await db
        .prepare(
          "SELECT id FROM exercise_sessions WHERE patient_id=? AND status IN ('active','paused')",
        )
        .bind(profile.id)
        .first();
      if (open)
        throw new HttpError(
          409,
          "Resume or finish your existing session first.",
        );
      const p = await db
        .prepare(
          `SELECT ${prescriptionCols} FROM prescriptions WHERE id=? AND patient_id=? AND therapist_id=? AND active=1`,
        )
        .bind(prescriptionId, profile.id, profile.therapistId)
        .first<Prescription>();
      if (!p) throw new HttpError(404, "Active prescription not found.");
      const now = Date.now();
      await db
        .prepare(
          "INSERT INTO exercise_sessions (id,patient_id,prescription_id,exercise,instructions,target,set_plan,status,started_at,updated_at) SELECT ?,?,?,?,?,CAST(? AS BIGINT),CAST(? AS TEXT),'paused',CAST(? AS BIGINT),CAST(? AS BIGINT) WHERE NOT EXISTS (SELECT 1 FROM exercise_sessions WHERE patient_id=? AND status IN ('active','paused')) ON CONFLICT DO NOTHING",
        )
        .bind(
          id,
          profile.id,
          p.id,
          p.name,
          p.instructions,
          p.reps * p.sets,
          // Every new session is judged by sets; an outdated client cannot opt out.
          JSON.stringify({ repsPerSet: p.reps, counts: [0] }),
          now,
          now,
          profile.id,
        )
        .run();
      const session = await db
        .prepare(
          `SELECT ${sessionCols} FROM exercise_sessions WHERE id=? AND patient_id=?`,
        )
        .bind(id, profile.id)
        .first<StoredSession>();
      if (!session)
        throw new HttpError(
          409,
          "Another session was started. Reload to resume it.",
        );
      return json({ session: parseSession(session) }, 201);
    }
    if (action === "session") {
      if (profile.role !== "patient")
        throw new HttpError(
          403,
          "Only patients can update their own sessions.",
        );
      const data = z
        .object({
          id: uuid,
          setCounts: z.array(z.number().int().min(0).max(10000)).min(1).max(10001).optional(),
          revision: z.number().int().min(0),
          reps: z.number().int().min(0).max(10000),
          seconds: z.number().int().min(0).max(86400),
          status: z.enum(["active", "paused", "finished"]),
          connection: z.enum(["connected", "disconnected"]),
          heart: z
            .array(
              z.object({
                at: z.number().int().min(0).max(86400),
                bpm: z.number().positive().max(300),
              }),
            )
            .max(7200),
        })
        .parse(input);
      const s = await db
        .prepare(
          `SELECT ${sessionCols} FROM exercise_sessions WHERE id=? AND patient_id=?`,
        )
        .bind(data.id, profile.id)
        .first<StoredSession>();
      if (!s) throw new HttpError(404, "Session not found.");
      if (s.finishedAt !== null) {
        if (
          data.status === "finished" &&
          data.reps === s.reps &&
          data.seconds === s.seconds
        )
          return json({ session: parseSession(s) });
        throw new HttpError(409, "This session has already been finalized.");
      }
      if (data.revision !== s.revision)
        throw new HttpError(
          409,
          "This session changed in another tab. Reload to use the latest saved version.",
        );
      if (data.reps < s.reps || data.seconds < s.seconds)
        throw new HttpError(400, "Saved session progress cannot decrease.");
      if (data.seconds > (Date.now() - s.startedAt) / 1000 + 5)
        throw new HttpError(400, "Exercise duration exceeds the session time.");
      if (
        data.heart.some(
          (h, i) =>
            h.at > data.seconds || (i > 0 && h.at < data.heart[i - 1].at),
        )
      )
        throw new HttpError(
          400,
          "Heart-rate timestamps must be ordered within the exercise duration.",
        );
      const oldHeart = JSON.parse(s.heart);
      if (
        data.heart.length < oldHeart.length ||
        JSON.stringify(data.heart.slice(0, oldHeart.length)) !== s.heart
      )
        throw new HttpError(
          400,
          "Saved heart-rate readings cannot be changed.",
        );
      const plan = parseSession(s).setPlan;
      if (plan) {
        const counts = data.setCounts;
        if (!counts) throw new HttpError(400, "Reload this page to save per-set progress.");
        const total = (values: number[]) => values.reduce((sum, n) => sum + n, 0);
        const last = plan.counts.length - 1;
        if (counts.length < plan.counts.length || counts[last] < plan.counts[last] ||
            plan.counts.slice(0, last).some((n, i) => counts[i] !== n) ||
            total(counts) - total(plan.counts) > data.reps - s.reps ||
            counts.slice(0, -1).some(n => n === 0))
          throw new HttpError(400, "Set counts do not match the recorded progress.");
        plan.counts = counts;
      }
      const targetMet = plan ? creditedSets(plan, s.target) * plan.repsPerSet >= s.target : data.reps >= s.target;
      const status =
        data.status === "finished"
          ? targetMet
            ? "completed"
            : "incomplete"
          : data.status;
      const now = Date.now();
      const result = await db
        .prepare(
          "UPDATE exercise_sessions SET reps=?,seconds=?,status=?,connection=?,heart=?,set_plan=?,updated_at=?,finished_at=?,revision=revision+1 WHERE id=? AND patient_id=? AND revision=?",
        )
        .bind(
          data.reps,
          data.seconds,
          status,
          data.connection,
          JSON.stringify(data.heart),
          plan ? JSON.stringify(plan) : null,
          now,
          data.status === "finished" ? now : null,
          data.id,
          profile.id,
          data.revision,
        )
        .run();
      if (!result.meta.changes)
        throw new HttpError(
          409,
          "Session changed in another tab. Reload to continue.",
        );
      const saved = await db
        .prepare(
          `SELECT ${sessionCols} FROM exercise_sessions WHERE id=? AND patient_id=?`,
        )
        .bind(data.id, profile.id)
        .first<StoredSession>();
      return json({ session: parseSession(saved!) });
    }
    throw new HttpError(400, "Unknown operation.");
  } catch (error) {
    return handleError(error);
  }
}
