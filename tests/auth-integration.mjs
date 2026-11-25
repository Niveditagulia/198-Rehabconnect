import assert from "node:assert/strict";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw new Error("Integration tests run against localhost only.");
const suffix = crypto.randomUUID().slice(0, 8),
  doctor = "test-clinician-" + suffix,
  patient = "test-patient-" + suffix,
  outsider = "test-other-" + suffix,
  otherPatient = "test-second-" + suffix;
const clinicianIds = new Set([doctor, outsider]);
let checks = 0;
const sessions = new Map();
async function call(id, body, status = 200, override = {}) {
  const headers = {
    ...(id
      ? {
          Cookie: sessions.get(id) || "",
          "x-rehabconnect-role": clinicianIds.has(id)
            ? "physiotherapist"
            : "patient",
        }
      : {}),
    ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
    ...override,
  };
  const response = await fetch(origin + "/api/app", {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, status, text);
  checks++;
  return JSON.parse(text);
}

async function auth(id, action, role, status = 200, extra = {}) {
  const response = await fetch(origin + "/api/auth", {
    method: "POST", headers: {"Content-Type":"application/json", Origin:origin},
    body: JSON.stringify({action,email:id+"@example.test",password:"A-real-test-password-198!",role,name:"Test "+role,...extra}),
    redirect:"manual",
  });
  const text = await response.text();
  assert.equal(response.status,status,text); checks++;
  if(response.ok && response.headers.get("set-cookie")) sessions.set(id,response.headers.get("set-cookie").split(";")[0]);
  return JSON.parse(text);
}
async function page(path,id,location) {
  const response = await fetch(origin+path,{headers:id?{Cookie:sessions.get(id)}:{},redirect:"manual"});
  assert.equal(response.status,307); assert.equal(response.headers.get("location"),location); checks++;
}
await call(null,null,401);
await page("/patient",null,"/login");
await page("/physiotherapist",null,"/login");
await auth(patient,"register","patient",201);
await auth(doctor,"register","physiotherapist",403,{inviteCode:"invalid"});
await auth(doctor,"register","physiotherapist",201,{inviteCode:process.env.THERAPIST_INVITE_CODE});
await auth(outsider,"register","physiotherapist",201,{inviteCode:process.env.THERAPIST_INVITE_CODE});
await auth(otherPatient,"register","patient",201);
await auth(patient,"login","physiotherapist",401);
await auth(patient,"login","patient",401,{password:"incorrect-password"});
await auth(patient,"login","patient");
await auth(doctor,"login","physiotherapist");
await page("/physiotherapist",patient,"/patient");
await page("/physiotherapist?role=physiotherapist",patient,"/patient");
await page("/patient",doctor,"/physiotherapist");
await page("/?role=physiotherapist",patient,"/patient");
await call(patient,null,403,{"x-rehabconnect-role":"physiotherapist"});
await call(patient,{action:"register",name:"Escalation",role:"physiotherapist"},403);
await call(patient,{action:"register",name:"Escalation",role:"physiotherapist"},403,{"x-rehabconnect-role":"physiotherapist"});
await call(patient,{action:"profile",name:"Test"},403,{Origin:"https://wrong.example"});
const forged = await fetch(origin+"/api/app",{headers:{"oai-authenticated-user-id":doctor,"oai-authenticated-user-email":doctor+"@example.test","x-rehabconnect-role":"physiotherapist"}});
assert.equal(forged.status,401); checks++;
const patientHtml = await (await fetch(origin+"/patient",{headers:{Cookie:sessions.get(patient)}})).text();
assert.ok(!patientHtml.includes("Physiotherapist workspace")); checks++;
for (const [path,id] of [["/patient",patient],["/physiotherapist",doctor],["/login",null],["/register",null]]) {
  const response=await fetch(origin+path,{headers:id?{Cookie:sessions.get(id)}:{}});
  assert.equal(response.status,200); checks++;
}
const code = (await call(doctor)).profile.careCode;
assert.equal((await call(doctor)).patients.length, 0);
await call(patient, { action: "link-preview", code });
await call(patient, { action: "link", code }, 400);
await call(patient, { action: "link", code, confirm: true });
assert.equal((await call(doctor)).patients[0].id, (await call(patient)).profile.id);
const prescription = {
  action: "prescribe",
  patientId: (await call(patient)).profile.id,
  name: "Test knee extension",
  instructions: "Follow the prescribed movement, slowly and with control.",
  reps: 2,
  sets: 1,
  minutes: 1,
};
await call(patient, prescription, 403);
await call(outsider, prescription, 403);
await call(doctor, { ...prescription, reps: 0 }, 400);
await call(doctor, prescription);
const assigned = (await call(patient)).prescriptions[0];
assert.equal((await call(otherPatient)).prescriptions.length, 0);
assert.equal((await call(outsider)).prescriptions.length, 0);
const sessionId = crypto.randomUUID();
const created = await call(
  patient,
  { action: "start", id: sessionId, prescriptionId: assigned.id },
  201,
);
assert.equal(created.session.target, 2);
// The server snapshots a set plan even when the client does not ask for one (outdated tabs cannot opt out).
assert.deepEqual(created.session.setPlan?.counts, [0]);
await call(patient, {
  action: "start",
  id: sessionId,
  prescriptionId: assigned.id,
});
await call(
  patient,
  { action: "start", id: crypto.randomUUID(), prescriptionId: assigned.id },
  409,
);
await call(
  otherPatient,
  { action: "start", id: crypto.randomUUID(), prescriptionId: assigned.id },
  404,
);
const update = {
  action: "session",
  id: sessionId,
  revision: 0,
  reps: 1,
  setCounts: [1],
  seconds: 0,
  heart: [{ at: 0, bpm: 80 }],
  status: "paused",
  connection: "connected",
};
await call(otherPatient, update, 404);
await call(doctor, update, 403);
await call(patient, { ...update, heart: [{ at: 0, bpm: -1 }] }, 400);
await call(patient, { ...update, setCounts: undefined }, 400);
await call(patient, update);
await call(patient, update, 409);
await call(patient, { ...update, revision: 1, reps: 0 }, 400);
await call(
  patient,
  { ...update, revision: 1, heart: [{ at: 0, bpm: 81 }] },
  400,
);
await call(patient, { action: "unlink" }, 409);
const incomplete = await call(patient, {
  ...update,
  revision: 1,
  status: "finished",
});
assert.equal(incomplete.session.status, "incomplete");
await call(patient, { ...update, revision: 1, status: "finished" });
assert.equal((await call(doctor)).sessions[0].heart[0].bpm, 80);
assert.equal((await call(outsider)).sessions.length, 0);
const second = crypto.randomUUID();
await call(
  patient,
  { action: "start", id: second, prescriptionId: assigned.id },
  201,
);
await call(doctor, {
  ...prescription,
  action: "update-prescription",
  id: assigned.id,
  reps: 5,
});
const completed = await call(patient, {
  ...update,
  id: second,
  revision: 0,
  reps: 2,
  setCounts: [2],
  status: "finished",
});
assert.equal(completed.session.target, 2);
assert.equal(completed.session.status, "completed");
const selectionCases = [
  { name: "Deadlift", reps: 8, sets: 5 },
  { name: "Ball squat", reps: 10, sets: 2 },
];
for (const exercise of selectionCases) {
  await call(doctor, { ...prescription, ...exercise });
}
const plan = (await call(patient)).prescriptions;
await call(doctor, { ...prescription, name: "Four sets test", reps: 8, sets: 4 });
const four = (await call(patient)).prescriptions.find(p => p.name === "Four sets test");
for (const [counts, expected] of [[[32], "incomplete"], [[8, 8, 8, 8], "completed"]]) {
  const id = crypto.randomUUID();
  const { session } = await call(patient, { action: "start", id, prescriptionId: four.id }, 201);
  assert.deepEqual(session.setPlan, { repsPerSet: 8, counts: [0] });
  const save = { ...update, id, revision: 0, seconds: 0, heart: [], status: "finished", reps: 32 };
  await call(patient, { ...save, setCounts: [32, 8] }, 400);
  await call(patient, { ...save, setCounts: counts });
  const record = (await call(doctor)).sessions.find(s => s.id === id);
  assert.deepEqual(record.setPlan.counts, counts);
  assert.equal(record.status, expected);
}
for (const exercise of selectionCases) {
  const selected = plan.find((item) => item.name === exercise.name);
  assert.ok(selected);
  const id = crypto.randomUUID();
  const { session } = await call(patient, { action: "start", id, prescriptionId: selected.id }, 201);
  assert.equal(session.exercise, exercise.name);
  assert.equal(session.target, exercise.reps * exercise.sets);
  await call(patient, { ...update, id, revision: 0, reps: 1, setCounts: [1], seconds: 3, heart: [], status: "finished" });
  const saved = (await call(patient)).sessions.find((item) => item.id === id);
  assert.equal(saved.prescriptionId, selected.id);
  assert.equal(saved.exercise, exercise.name);
  assert.equal(saved.reps, 1);
  assert.equal(saved.status, "incomplete");
}
await call(patient, { action: "unlink" });
assert.equal((await call(doctor)).patients.length, 0);
assert.equal((await call(doctor)).sessions.length, 0);
const final = await call(patient);
assert.equal(final.sessions.length, 6);
assert.ok(final.prescriptions.every((p) => p.active === 0));

const cookieBeforeLogout=sessions.get(patient);
const logout=await fetch(origin+"/api/auth",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,Cookie:cookieBeforeLogout},body:JSON.stringify({action:"logout"})});
assert.equal(logout.status,200); checks++;
assert.equal((await logout.json()).redirect,"/login"); checks++;
await call(patient,null,401);
await page("/patient",patient,"/login");
await auth(patient,"login","patient");
assert.equal((await call(patient)).profile.role,"patient");
await auth(doctor,"login","physiotherapist");
assert.equal((await call(doctor)).profile.role,"physiotherapist");
const parts=sessions.get(patient).split("=");
const token=parts[1].split(".");
const payload=JSON.parse(Buffer.from(token[1],"base64url").toString());
payload.role="physiotherapist";
token[1]=Buffer.from(JSON.stringify(payload)).toString("base64url");
const tampered=await fetch(origin+"/api/app",{headers:{Cookie:parts[0]+"="+token.join("."),"x-rehabconnect-role":"physiotherapist"}});
assert.equal(tampered.status,401); checks++;
// The same email can own separately authenticated patient and clinician accounts.
await auth(patient,"register","physiotherapist",403,{inviteCode:"invalid"});
await auth(patient,"register","physiotherapist",201,{inviteCode:process.env.THERAPIST_INVITE_CODE});
await auth(patient,"login","physiotherapist");
await page("/patient",patient,"/physiotherapist");
const sameEmailClinician = await fetch(origin+"/api/app",{headers:{Cookie:sessions.get(patient),"x-rehabconnect-role":"physiotherapist"}});
assert.equal(sameEmailClinician.status,200); checks++;
assert.equal((await sameEmailClinician.json()).profile.role,"physiotherapist");
await auth(patient,"login","patient");
await page("/physiotherapist",patient,"/patient");
const csrf = await fetch(origin+"/api/auth",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://wrong.example",Cookie:sessions.get(patient)},body:JSON.stringify({action:"logout"})});
assert.equal(csrf.status,403); checks++;
await call(patient);
console.log("PASS: "+checks+" checks — both role logins, patient dashboard isolation, forged role/header/token rejection, logout revocation and re-login, prescriptions, sessions, reports and care relationships.");
