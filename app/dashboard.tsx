"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  LayoutDashboard,
  Play,
  Users,
  History,
  Settings2,
  Radio,
  CheckCircle2,
  Footprints,
  Download,
  X,
  Plus,
  Search,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Dumbbell,
} from "lucide-react";
import { advanceSets, creditedSets, resumePlan, FRESH_SET_MESSAGE } from "../lib/set-progress";
import Figure from "../components/exercise-figure";
import SignOutButton from "./signout-button";
import { useUsbSensor } from "../lib/use-usb-sensor";
import {
  counterDelta,
  type Reading,
} from "../lib/sensor-protocol";
import {
  catalog,
  isOpen,
  type AppData,
  type Profile,
  type Prescription,
  type ExerciseSession,
} from "../lib/models";
class AppError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function selectedRole(): "patient" | "physiotherapist" {
  return typeof window !== "undefined" && window.location.pathname === "/physiotherapist" ? "physiotherapist" : "patient";
}
async function api(body?: unknown) {
  const r = await fetch("/api/app", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: {
      "X-RehabConnect-Role": selectedRole(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json()) as {
    error?: string;
    session: ExerciseSession;
    therapist: { id: string; name: string; email: string };
  };
  if (!r.ok) throw new AppError(r.status, data.error || "Request failed. Please try again.");
  return data;
}
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
function setSummary(s: ExerciseSession) {
  return s.setPlan
    ? creditedSets(s.setPlan, s.target) + " / " + (s.target / s.setPlan.repsPerSet) + " sets completed"
    : s.reps + " / " + s.target + " reps";
}
function progressPercent(s: ExerciseSession) {
  if (!s.setPlan) return Math.round(100 * s.reps / s.target);
  return Math.round(100 * creditedSets(s.setPlan, s.target) / (s.target / s.setPlan.repsPerSet));
}
const label = (s: ExerciseSession) =>
  isOpen(s)
    ? Date.now() - s.updatedAt > 12000
      ? "Interrupted"
      : s.connection === "disconnected"
        ? "Tracker disconnected"
      : s.status === "active"
        ? "In progress"
        : "Paused"
    : s.status === "completed"
      ? !s.setPlan && s.reps > s.target
        ? "Completed · above target"
        : "Completed"
      : "Incomplete";
export default function Dashboard({role}: {role: "patient" | "physiotherapist"}) {
  const [data, setData] = useState<AppData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refreshError, setRefreshError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("Overview"),
    [patientId, setPatientId] = useState(""),
    [search, setSearch] = useState(""),
    [range, setRange] = useState("30"),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<ExerciseSession | null>(null),
    [detail, setDetail] = useState<Prescription | null>(null),
    [pendingExerciseId, setPendingExerciseId] = useState(""),
    [editor, setEditor] = useState<Partial<Prescription> | null>(null),
    [session, setSession] = useState<ExerciseSession | null>(null),
    [running, setRunning] = useState(false),
    [syncError, setSyncError] = useState(""),
    [syncConflict, setSyncConflict] = useState(false),
    [lastSaved, setLastSaved] = useState(0),
    [largeText, setLargeText] = useState(false),
    [patientEmail, setPatientEmail] = useState("");
  const current = useRef<ExerciseSession | null>(null),
    writesSession = useRef(false),
    refreshSequence = useRef(0),
    run = useRef(false),
    baseline = useRef<Reading | null>(null),
    lastTrackedPacket = useRef<Reading | null>(null),
    [finishing, setFinishing] = useState(false),
    lock = useRef<Promise<void> | null>(null),
    loaded = useRef(false);
  const updateSession = (fn: (s: ExerciseSession) => ExerciseSession) => {
    if (!current.current) return;
    current.current = fn(current.current);
    setSession(current.current);
  };
  function holdSession() {
    baseline.current = null;
    run.current = false;
    setRunning(false);
  }
  const usb = useUsbSensor((next) => {
    if (!run.current || !current.current || !baseline.current) return;
    const previous = baseline.current;
    const delta = counterDelta(previous, next);
    if (delta === null) { holdSession(); return; }
    baseline.current = next;
    lastTrackedPacket.current = next;
    const jump = next.setId - previous.setId;
    if (delta || jump) updateSession(s => ({
      ...s, reps: s.reps + delta,
      setPlan: s.setPlan ? advanceSets(s.setPlan, delta, jump, next.setReps) : null,
    }));
    if (previous.state !== "paused" && next.state === "paused") void sync();
  }, holdSession);
  const fresh = usb.connected && !usb.stale && !!usb.reading;
  const sensorReady = fresh && usb.reading?.state === "running";
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const next = (await api()) as unknown as AppData;
      if (sequence !== refreshSequence.current) return;
      setData(next);
      setPatientId((id) => id || next.profile?.id || "");
      if (!writesSession.current && !lock.current && next.profile?.role === "patient") {
        const open = next.sessions.find(isOpen);
        if (open) {
          const firstLoad = !loaded.current;
          if (current.current?.id !== open.id) lastTrackedPacket.current = null;
          setSession(open);
          current.current = open;
          setRunning(false);
          if (firstLoad) {
            setTab("Live session");
            setNotice("A session is open. Continue here if this is the tracking tab.");
          }
        } else if (current.current) {
          current.current = null;
          setSession(null);
          setFinishing(false);
        }
      }
      loaded.current = true;
      setRefreshError("");
    } catch (e) {
      if (sequence !== refreshSequence.current) return;
      setRefreshError((e as Error).message);
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setSelected((previous) =>
      previous
        ? data?.sessions.find((s) => s.id === previous.id) || null
        : null,
    );
  }, [data]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (!running || !sensorReady) return;
    const timer = setInterval(() => {
      if (run.current && usb.snapshot()?.state === "running")
        updateSession(s => ({...s, seconds: Math.min(86400, s.seconds + 1)}));
    }, 1000);
    return () => clearInterval(timer);
  }, [running, sensorReady, session?.id]);
  const sync = useCallback(
    async (finish = false, leaving = false) => {
      while (lock.current) await lock.current;
      const snap = current.current;
      if (!snap || (!finish && !writesSession.current)) return;
      let failed = false;
      const task = (async () => {
        try {
          const saved = await api({
            action: "session",
            id: snap.id,
            revision: snap.revision,
            reps: snap.reps,
            setCounts: snap.setPlan?.counts,
            seconds: snap.seconds,
            heart: snap.heart,
            status: finish
              ? "finished"
              : run.current && baseline.current?.state === "running"
                ? "active"
                : "paused",
            connection: !leaving && usb.snapshot() ? "connected" : "disconnected",
          });
          setLastSaved(Date.now());
          setSyncError("");
          setSyncConflict(false);
          if (finish) {
            writesSession.current = false;
            lastTrackedPacket.current = null;
            current.current = null;
            setSession(null);
            setFinishing(false);
            setRunning(false);
            setSelected(saved.session);
            setTab("Exercise history");
            await refresh();
          } else if (current.current?.id === snap.id) {
            current.current = {
              ...current.current,
              revision: saved.session.revision,
              updatedAt: saved.session.updatedAt,
            };
            setSession(current.current);
          }
        } catch (e) {
          failed = true;
          setSyncError((e as Error).message);
          if (e instanceof AppError && e.status === 409) {
            setSyncConflict(true);
            writesSession.current = false;
            holdSession();
            setFinishing(false);
          }
        }
      })();
      lock.current = task;
      await task;
      if (lock.current === task) lock.current = null;
      return !failed;
    },
    [refresh],
  );
  useEffect(() => {
    const t = setInterval(() => {
      if (writesSession.current && current.current && !lock.current && !finishing) void sync();
    }, 3000);
    return () => clearInterval(t);
  }, [sync, finishing]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (writesSession.current && current.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function mutate(body: unknown, message?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api(body);
      if (message) setNotice(message);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function start(p: Prescription) {
    setError("");
    setDetail(null);
    if (session) {
      setTab("Live session");
      return;
    }
    if (!sensorReady) {
      setPendingExerciseId(p.id);
      setTab("Device connection");
      return;
    }
    if (usb.snapshot()?.setReps) {
      setPendingExerciseId(p.id);
      setTab("Device connection");
      setError(FRESH_SET_MESSAGE.replace("continue", "start"));
      return;
    }
    setBusy(true);
    try {
      const result = await api({
        action: "start",
        trackSets: true,
        id: crypto.randomUUID(),
        prescriptionId: p.id,
      });
      const startPacket = usb.snapshot();
      setPendingExerciseId("");
      writesSession.current = true;
      baseline.current = startPacket?.state === "running" && startPacket.setReps === 0 ? startPacket : null;
      lastTrackedPacket.current = baseline.current;
      current.current = result.session;
      setSession(result.session);
      run.current = !!baseline.current;
      setRunning(run.current);
      setTab("Live session");
      setSyncError("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    holdSession();
    setFinishing(true);
    setBusy(true);
    await sync(true);
    setBusy(false);
  }
  function resume() {
    const packet = usb.snapshot();
    if (finishing || packet?.state !== "running" || !current.current) return;
    const decision = resumePlan(current.current.setPlan, lastTrackedPacket.current, packet);
    if (!decision.ok) { setError(decision.reason); return; }
    setError("");
    updateSession(s => ({...s, setPlan: decision.plan}));
    lastTrackedPacket.current = packet;
    baseline.current = packet;
    writesSession.current = true;
    run.current = true;
    setRunning(true);
    setSyncError("");
    void sync();
  }
  const profile = data?.profile,
    clinician = role === "physiotherapist";
  const actualPatient = clinician
    ? data?.patients.find((p) => p.id === patientId) || data?.patients[0]
    : profile;
  const plan = (data?.prescriptions || []).filter(
      (p) => p.patientId === actualPatient?.id && p.active,
    ),
    own = (data?.sessions || []).filter(
      (s) => s.patientId === actualPatient?.id,
    ),
    recorded = own.filter((s) => !isOpen(s));
  const today = recorded.filter(
      (s) =>
        new Date(s.finishedAt!).toDateString() === new Date().toDateString(),
    ),
    done = new Set(
      today
        .filter((s) => s.status === "completed")
        .map((s) => s.prescriptionId),
    ),
    completion = plan.length
      ? Math.round(
          (plan.filter((p) => done.has(p.id)).length / plan.length) * 100,
        )
      : 0;
  const filtered = own.filter(
    (s) =>
      (range === "all" ||
        Date.now() - s.startedAt < Number(range) * 86400000) &&
      (filter === "all" || s.status === filter),
  );
  const pendingExercise = plan.find(p => p.id === pendingExerciseId);
  const preferenceKey = profile && "rehabconnect.largeText." + profile.id;
  useEffect(() => {
    try { setLargeText(!!preferenceKey && localStorage.getItem(preferenceKey) === "true"); }
    catch { setLargeText(false); }
  }, [preferenceKey]);
  async function saveBeforeSignOut() {
    if (!current.current || !writesSession.current) return true;
    holdSession();
    const saved = await sync(finishing, true);
    if (saved) writesSession.current = false;
    return saved === true;
  }
  const exportRecords = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            patient: actualPatient?.name,
            prescriptions: plan,
            sessions: filtered.map((s) => ({
              ...s,
              result: setSummary(s),
              completionBasis: s.setPlan
                ? "Sets: a set counts when one tracker set reaches the prescribed reps"
                : "Total reps (session recorded before per-set tracking)",
              setsCredited: s.setPlan ? creditedSets(s.setPlan, s.target) : null,
              setsPrescribed: s.setPlan ? s.target / s.setPlan.repsPerSet : null,
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "rehabconnect-exercise-records.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const exerciseStatus = (p: Prescription) =>
    own.some(s => s.prescriptionId === p.id && isOpen(s)) || session?.prescriptionId === p.id
      ? "In progress"
      : done.has(p.id)
        ? "Completed"
        : today.some((s) => s.prescriptionId === p.id)
          ? "Incomplete"
          : "Not started";
  if (loading)
    return (
      <div className="app-loading">
        <Activity size={32} />
        <h2>Opening your workspace…</h2>
      </div>
    );
  if (!data)
    return (
      <div className="app-loading">
        <AlertCircle size={32} />
        <h2>Unable to open your workspace</h2>
        <p>{refreshError || error}</p>
        <button
          className="primary"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
        >
          Retry
        </button>
        <a href="/login" target="_top">
          Sign in again
        </a>
      </div>
    );
  if (!profile) return <div className="app-loading"><p>Account setup is unavailable. Please log in again.</p><a href="/login">Log in</a></div>;
  const nav = clinician
    ? ["Overview", "Patient reports", "Assign exercises", "Account settings"]
    : [
        "Overview",
        "My exercises",
        "Live session",
        "Exercise history",
        "My progress",
        "Device connection",
        "Account settings",
      ];
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className={"shell " + (largeText ? "large-text" : "")}>
        <aside className="sidebar">
          <a className="brand" href="/">
            <span className="brand-icon">
              <Activity size={23} />
            </span>
            rehab<span>connect</span>
          </a>
          <div className="workspace-label">
            {clinician ? "CARE WORKSPACE" : "YOUR RECOVERY"}
          </div>
          <nav>
            {nav.map((n) => {
              const Icon =
                n === "Overview"
                  ? LayoutDashboard
                  : n === "Patient reports"
                    ? Users
                    : n.includes("progress") || n === "Exercise history"
                      ? History
                      : n === "Device connection"
                        ? Radio
                        : n === "My exercises" || n === "Assign exercises"
                          ? Footprints
                          : n === "Live session"
                            ? Activity
                            : Settings2;
              return (
                <button
                  key={n}
                  className={"nav-item " + (tab === n ? "selected" : "")}
                  onClick={() => setTab(n)}
                >
                  <Icon size={19} />
                  {n}
                  {tab === n && <span className="nav-dot" />}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <div className="care-note">
              <ShieldCheck size={20} />
              <strong>Your care, connected.</strong>
              <p>
                {clinician
                  ? "Only patients you add by email appear here."
                  : "Reps come from the tracker attached to your equipment."}
              </p>
            </div>
            <div className="profile">
              <span className="avatar">
                {profile.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{profile.name}</strong>
                <small>{clinician ? "Physiotherapist" : "Patient"}</small>
              </div>
            </div>
            <SignOutButton className="logout-link" beforeSignOut={saveBeforeSignOut}/>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <span className="breadcrumb">
              Workspace <ChevronRight size={14} /> {tab}
            </span>
            <div className="top-actions">
              <span className="account-pill">
                <ShieldCheck size={13} /> Signed in
              </span>
              <span className="avatar">{profile.name[0]}</span>
              <span className="workspace-switch">{clinician ? "Physiotherapist" : "Patient"} workspace</span>
              <SignOutButton className="topbar-logout" beforeSignOut={saveBeforeSignOut}/>
            </div>
          </header>
          <main id="main-content">
            <div className="page-heading">
              <div className="eyebrow">
                {clinician
                  ? "CONNECTED CARE, AT A GLANCE"
                  : "YOUR RECOVERY, ONE STEP AT A TIME"}
              </div>
              <div className="heading-row">
                <div>
                  <h1>
                    {tab === "Overview"
                      ? `Welcome back, ${profile.name.split(" ")[0]}.`
                      : tab === "Patient reports"
                        ? "Patient reports."
                        : tab === "My exercises"
                          ? "Your exercise plan."
                          : tab === "Live session"
                            ? "Move with confidence."
                            : tab === "Device connection"
                              ? "Connect your sensor."
                              : tab === "Account settings"
                                ? "Your account."
                                : tab === "Assign exercises"
                                  ? "Assign patient exercises."
                                  : tab.includes("progress")
                                    ? "Every step counts."
                                    : "Your session history."}
                  </h1>
                  <p>
                    {clinician
                      ? "Prescribe, monitor, and support your patients."
                      : "Your prescribed plan. Your measured progress."}
                  </p>
                </div>
                <span className="date-label">
                  ECE198 <span>/</span> GROUP 02
                </span>
              </div>
            </div>
            {(error || refreshError) && (
              <div className="warning app-alert" role="alert">
                <AlertCircle size={17} />
                <span>{error || refreshError}</span>
                <button onClick={() => error ? setError("") : setRefreshError("")} aria-label="Dismiss error">
                  <X size={15} />
                </button>
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                {notice}
                <button
                  onClick={() => setNotice("")}
                  aria-label="Dismiss message"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {clinician &&
              data.patients.length > 0 &&
              (tab === "Overview" || tab === "Assign exercises") && (
                <div className="patient-selector">
                  <label htmlFor="patient">Working with</label>
                  <select
                    id="patient"
                    value={actualPatient?.id || ""}
                    onChange={(e) => setPatientId(e.target.value)}
                  >
                    {data.patients.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span className="muted">
                    Select a patient to view or update their care plan
                  </span>
                </div>
              )}
            {tab === "Overview" && (
              <>
                <section className="stats">
                  {clinician ? (
                    <>
                      <div className="stat">
                        <span className="stat-label">
                          Your patients <Users size={17} />
                        </span>
                        <div className="stat-value">{data.patients.length}</div>
                        <button
                          className="text-button"
                          onClick={() => setTab("Patient reports")}
                        >
                          View patients <ArrowRight size={14} />
                        </button>
                      </div>
                      <div className="stat">
                        <span className="stat-label">
                          Exercising now <Activity size={17} />
                        </span>
                        <div className="stat-value">
                          {
                            data.sessions.filter(
                              (s) =>
                                s.status === "active" &&
                                s.connection === "connected" &&
                                Date.now() - s.updatedAt < 12000,
                            ).length
                          }
                        </div>
                        <span className="muted">Updated every 5 seconds</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">
                          Completed sessions <CheckCircle2 size={17} />
                        </span>
                        <div className="stat-value">
                          {
                            data.sessions.filter(
                              (s) => s.status === "completed",
                            ).length
                          }
                        </div>
                        <span className="muted">
                          Across your patients
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">
                          Patients to review <AlertCircle size={17} />
                        </span>
                        <div className="stat-value">
                          {
                            new Set(
                              data.sessions
                                .filter(
                                  (s) =>
                                    s.status === "incomplete" ||
                                    (isOpen(s) && (s.connection === "disconnected" ||
                                      Date.now() - s.updatedAt > 12000)),
                                )
                                .map((s) => s.patientId),
                            ).size
                          }
                        </div>
                        <span className="muted">
                          Incomplete or interrupted sessions
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="stat">
                        <span className="stat-label">
                          Today’s completion <CheckCircle2 size={17} />
                        </span>
                        <div className="stat-value">
                          {completion}
                          <small>%</small>
                        </div>
                        <span className="muted">
                          {plan.filter((p) => done.has(p.id)).length} of{" "}
                          {plan.length} exercises completed
                        </span>
                        <div className="thin-progress">
                          <i style={{ width: completion + "%" }} />
                        </div>
                      </div>
                      <div className="stat">
                        <span className="stat-label">
                          Exercise time <Clock size={17} />
                        </span>
                        <div className="stat-value">
                          {Math.floor(
                            today.reduce((sum, s) => sum + s.seconds, 0) / 60,
                          )}
                          <small> min</small>
                        </div>
                        <span className="muted">Recorded today</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">
                          Remaining exercises <Footprints size={17} />
                        </span>
                        <div className="stat-value">
                          {plan.filter((p) => !done.has(p.id)).length}
                        </div>
                        <span className="muted">On today’s plan</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">
                          Sensor connection <Radio size={17} />
                        </span>
                        <div className="connection-value">
                          {fresh ? "USB connected" : "Not connected"}
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab("Device connection")}
                        >
                          Connect Arduino <ArrowRight size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </section>
                <div className="content-grid">
                  <section>
                    <div className="section-heading">
                      <div>
                        <h2>
                          {clinician
                            ? `${actualPatient?.name || "Patient"}’s plan`
                            : "Your exercise plan"}
                        </h2>
                        <p>
                          {plan.length
                            ? `${plan.length} prescribed exercises`
                            : "Your assigned exercises will appear here."}
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          setTab(
                            clinician ? "Assign exercises" : "My exercises",
                          )
                        }
                      >
                        View plan <ArrowRight size={14} />
                      </button>
                    </div>
                    <div className="hero-card">
                      <div>
                        <span className="eyebrow">
                          {clinician
                            ? "PERSONALIZED CARE"
                            : "LET’S KEEP YOU MOVING"}
                        </span>
                        <h2>
                          {clinician ? (
                            <>
                              Progress begins
                              <br />
                              with a plan.
                            </>
                          ) : (
                            <>
                              Your next step
                              <br />
                              starts here.
                            </>
                          )}
                        </h2>
                        <p>
                          {clinician
                            ? "Assign clear targets and review measured results."
                            : session
                              ? "You have a saved session to resume."
                              : sensorReady ? "Select an assigned exercise to begin recording." : "Connect your sensor to begin recording."}
                        </p>
                        <button
                          className="primary"
                          onClick={() =>
                            setTab(
                              clinician
                                ? "Assign exercises"
                                : session
                                  ? "Live session"
                                  : sensorReady ? "My exercises" : "Device connection",
                            )
                          }
                        >
                          <ArrowRight size={16} />
                          {clinician
                            ? "Manage prescriptions"
                            : session
                              ? "Resume session"
                              : sensorReady ? "Choose an exercise" : "Connect your sensor"}
                        </button>
                      </div>
                      <div className="hero-art">
                        <div className="art-orbit" />
                        <Figure />
                        <span className="art-badge">
                          <Check size={13} /> At your own pace
                        </span>
                      </div>
                    </div>
                    {plan.length ? (
                      <div className="exercise-list">
                        {plan.map((p, i) => (
                          <article className="exercise-card" key={p.id}>
                            <div className={"exercise-art art-" + (i % 3)}>
                              <Dumbbell aria-hidden="true" />
                            </div>
                            <div className="exercise-info">
                              <span className="eyebrow">
                                {exerciseStatus(p)}
                              </span>
                              <h3>{p.name}</h3>
                              <p>
                                {p.sets} sets · {p.reps} reps · ~{p.minutes} min
                              </p>
                            </div>
                            <button
                              className="round-button"
                              aria-label={"View " + p.name}
                              onClick={() => setDetail(p)}
                            >
                              <ArrowRight size={17} />
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-panel">
                        <Footprints size={28} />
                        <h3>No prescribed exercises yet</h3>
                        <p>
                          {clinician
                            ? "Add a patient by email, then create their first prescription."
                            : data.therapist
                              ? "Your physiotherapist has not assigned a plan yet."
                              : "Your physiotherapist adds you using your account email (" + profile.email + "), then assigns your exercises."}
                        </p>
                        <button
                          className="secondary"
                          onClick={() =>
                            setTab(
                              clinician
                                ? "Patient reports"
                                : "Account settings",
                            )
                          }
                        >
                          {clinician
                            ? "Add a patient"
                            : "View account details"}
                        </button>
                      </div>
                    )}
                  </section>
                  <aside className="right-column">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Today’s progress</h2>
                        <Footprints size={18} />
                      </div>
                      <div
                        className="progress-ring"
                        style={{
                          background: `conic-gradient(#6878d6 ${completion}%,#edf0f7 0)`,
                        }}
                      >
                        <div>
                          <strong>
                            {completion}
                            <small>%</small>
                          </strong>
                          <span>of assigned exercises</span>
                        </div>
                      </div>
                      <p className="center-note">
                        {plan.length
                          ? "Based on saved, completed sessions."
                          : "A plan is the first step."}
                      </p>
                      <div className="divider" />
                      <button
                        className="secondary full"
                        onClick={() =>
                          setTab(
                            clinician ? "Patient reports" : "Exercise history",
                          )
                        }
                      >
                        View session history <ArrowRight size={15} />
                      </button>
                    </section>
                    <section className="tip-card">
                      <span className="eyebrow">
                        <Activity size={15} /> YOUR PACE MATTERS
                      </span>
                      <h3>Consistency over intensity.</h3>
                      <p>
                        Follow your prescribed plan. The sensor measures the
                        equipment movement; it does not confirm
                        correct technique.
                      </p>
                    </section>
                  </aside>
                </div>
                <section className="recent-section">
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <button
                      className="text-button"
                      onClick={() =>
                        setTab(
                          clinician ? "Patient reports" : "Exercise history",
                        )
                      }
                    >
                      View all <ArrowRight size={14} />
                    </button>
                  </div>
                  {(clinician ? data.sessions : own).slice(0, 4).map((s) => (
                    <button
                      className="session-row"
                      key={s.id}
                      onClick={() => setSelected(s)}
                    >
                      <Activity size={18} />
                      <div>
                        <strong>{s.exercise}</strong>
                        <small>
                          {clinician
                            ? data.patients.find((p) => p.id === s.patientId)
                                ?.name + " · "
                            : ""}
                          {new Date(s.startedAt).toLocaleString()}
                        </small>
                      </div>
                      <span>
                        {setSummary(s)}
                      </span>
                      <span
                        className={
                          "status " +
                          (s.status === "completed" ? "success" : "")
                        }
                      >
                        {label(s)}
                      </span>
                    </button>
                  ))}
                  {!(clinician ? data.sessions : own).length && (
                    <p className="empty">No sessions recorded yet.</p>
                  )}
                </section>
              </>
            )}
            {tab === "Patient reports" && clinician && (
              <>
                <section className="invite-banner">
                  <div>
                    <span className="eyebrow">ADD A PATIENT</span>
                    <h2>Add a patient by email.</h2>
                    <p>
                      Enter the email the patient used to create their RehabConnect
                      account. You can then assign their exercises.
                    </p>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const result = await mutate(
                        { action: "add-patient", email: patientEmail.trim() },
                        "Patient added. You can now assign exercises.",
                      );
                      if (result) setPatientEmail("");
                    }}
                  >
                    <input
                      type="email"
                      aria-label="Patient email"
                      placeholder="patient@example.com"
                      value={patientEmail}
                      onChange={(e) => setPatientEmail(e.target.value)}
                      required
                    />
                    <button className="secondary" disabled={busy}>
                      Add patient
                    </button>
                  </form>
                </section>
                <label className="search-label">
                  Search patient reports
                  <input
                    placeholder="Type a patient name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="patient-cards">
                  {data.patients
                    .filter((p) =>
                      p.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p) => {
                      const ps = data.sessions.filter(
                          (s) => s.patientId === p.id,
                        ),
                        live = ps.find(isOpen),
                        completed = ps.filter(
                          (s) => s.status === "completed",
                        ).length;
                      return (
                        <button
                          className={
                            "panel patient-card " +
                            (actualPatient?.id === p.id ? "active-patient" : "")
                          }
                          key={p.id}
                          onClick={() => setPatientId(p.id)}
                        >
                          <span className="avatar">
                            {p.name
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                          <strong>{p.name}</strong>
                          <span>
                            {ps.length} sessions · {completed} completed
                          </span>
                          <span className="status">
                            {live ? label(live) : "Not exercising"}
                          </span>
                          <small className="muted">
                            Last session:{" "}
                            {ps[0]
                              ? new Date(ps[0].startedAt).toLocaleString()
                              : "No sessions yet"}
                          </small>
                        </button>
                      );
                    })}
                </div>
                {!data.patients.filter((p) =>
                  p.name.toLowerCase().includes(search.toLowerCase()),
                ).length && (
                  <p className="empty-panel">
                    {search
                      ? "No patients match your search."
                      : "Add a patient with the email they registered with."}
                  </p>
                )}
              </>
            )}
            {(tab === "My exercises" || tab === "Assign exercises") && (
              <>
                <div className="section-heading section-spaced">
                  <div>
                    <h2>
                      {clinician
                        ? actualPatient
                          ? actualPatient.name + "’s prescriptions"
                          : "Assign exercises"
                        : "Prescribed for you"}
                    </h2>
                    <p>Each target comes from your physiotherapist.</p>
                  </div>
                  {clinician && actualPatient && (
                    <button
                      className="primary"
                      onClick={() =>
                        setEditor({
                          ...catalog[0],
                          patientId: actualPatient.id,
                        })
                      }
                    >
                      <Plus size={16} /> Assign exercise
                    </button>
                  )}
                </div>
                <div className="library-grid">
                  {plan.map((p, i) => (
                    <article className="panel library-card" key={p.id}>
                      <div className={"exercise-art art-" + (i % 3)}>
                        <Dumbbell aria-hidden="true" />
                      </div>
                      <span
                        className={
                          "status " + (done.has(p.id) ? "success" : "")
                        }
                      >
                        {exerciseStatus(p)}
                      </span>
                      <h2>{p.name}</h2>
                      <p>{p.instructions}</p>
                      <div className="library-target">
                        <strong>{p.reps}</strong> reps ×{" "}
                        <strong>{p.sets}</strong> sets{" "}
                        <span>~{p.minutes} min</span>
                      </div>
                      {clinician ? (
                        <div className="card-actions">
                          <button
                            className="secondary"
                            onClick={() => setEditor(p)}
                          >
                            Edit targets
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                { action: "archive-prescription", id: p.id },
                                "Exercise archived. Existing session history is preserved.",
                              )
                            }
                          >
                            Archive
                          </button>
                        </div>
                      ) : (
                        <button
                          className="primary full"
                          disabled={busy}
                          onClick={() => void start(p)}
                        >
                          <Play size={16} />{" "}
                          {session ? "View current session" : "Start exercise"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {!plan.length && (
                  <div className="empty-panel">
                    <Footprints size={30} />
                    <h3>No active prescriptions</h3>
                    <p>
                      {clinician
                        ? "Select a connected patient and assign an exercise."
                        : "Your physiotherapist’s prescriptions will appear here."}
                    </p>
                  </div>
                )}
              </>
            )}
            {(tab === "Exercise history" ||
              tab === "My progress" ||
              (clinician && tab === "Patient reports")) && (
              <>
                <div className="section-heading section-spaced">
                  <div>
                    <h2>{actualPatient?.name || "Patient"}’s activity</h2>
                    <p>Saved session totals and progress against the prescribed target.</p>
                  </div>
                  <button
                    className="secondary"
                    disabled={!actualPatient}
                    onClick={exportRecords}
                  >
                    <Download size={16} /> Export
                  </button>
                </div>
                <div className="filters">
                  <label>
                    Date range
                    <select
                      value={range}
                      onChange={(e) => setRange(e.target.value)}
                    >
                      <option value="7">Last 7 days</option>
                      <option value="30">Last 30 days</option>
                      <option value="90">Last 90 days</option>
                      <option value="all">All time</option>
                    </select>
                  </label>
                  <label>
                    Status
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All sessions</option>
                      <option value="completed">Completed</option>
                      <option value="incomplete">Incomplete</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                    </select>
                  </label>
                  <span className="muted">
                    {filtered.length} sessions ·{" "}
                    {
                      new Set(
                        filtered.map((s) =>
                          new Date(s.startedAt).toDateString(),
                        ),
                      ).size
                    }{" "}
                    active days · latest 1,000 accessible sessions
                  </span>
                </div>
                {tab !== "Exercise history" && (
                  <div className="progress-panels">
                    <section className="panel">
                      <h2>Repetitions against target</h2>
                      <div className="history-chart">
                        {filtered
                          .filter((s) => !isOpen(s))
                          .slice(0, 10)
                          .reverse()
                          .map((s) => (
                            <div key={s.id}>
                              <span>
                                {setSummary(s)}
                              </span>
                              <i
                                style={{
                                  height:
                                    Math.min(100, progressPercent(s)) +
                                    "px",
                                }}
                              />
                              <small>
                                {new Date(s.startedAt).toLocaleDateString(
                                  undefined,
                                  { month: "short", day: "numeric" },
                                )}
                              </small>
                            </div>
                          ))}
                        {!filtered.some((s) => !isOpen(s)) && (
                          <p className="empty">
                            Complete a session to see your progress.
                          </p>
                        )}
                      </div>
                    </section>
                    <section className="panel">
                      <h2>Sensor measurement</h2>
                      <div className="chart-empty">
                        <Activity size={24} />
                        <p>The Arduino counts changes in acceleration. A set earns one credit when it reaches its prescribed reps. The black button separates sets. Earlier sessions may show only total reps.</p>
                      </div>
                    </section>
                  </div>
                )}
                <div className="session-list">
                  {filtered.map((s) => (
                    <button
                      className="session-row"
                      key={s.id}
                      onClick={() => setSelected(s)}
                    >
                      <Activity size={19} />
                      <div>
                        <strong>{s.exercise}</strong>
                        <small>
                          {new Date(s.startedAt).toLocaleString()} ·{" "}
                          {duration(s.seconds)}
                        </small>
                      </div>
                      <span>
                        {setSummary(s)}
                        <small>
                          {progressPercent(s)}% of target
                        </small>
                      </span>
                      <span
                        className={
                          "status " +
                          (s.status === "completed" ? "success" : "")
                        }
                      >
                        {label(s)}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
                {!filtered.length && (
                  <div className="empty-panel">
                    <History size={28} />
                    <h3>No sessions in this range</h3>
                    <p>Saved sessions will appear here automatically.</p>
                  </div>
                )}
              </>
            )}
            {tab === "Live session" &&
              !clinician &&
              (session ? (
                <section className="live-workspace">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">
                        ARDUINO USB · MEASURED ACTIVITY
                      </span>
                      <h2>{session.exercise}</h2>
                    </div>
                    <span
                      className={
                        "status " + (running && sensorReady ? "success" : "")
                      }
                    >
                      {running
                        ? sensorReady
                          ? "Recording"
                          : usb.reading?.state === "paused" ? "Paused on tracker" : "Calibrating"
                        : writesSession.current ? "Paused" : "Viewing saved session"}
                    </span>
                  </div>
                  <p>{session.instructions}</p>
                  {syncError && (
                    <div className="warning" role="alert">
                      {syncConflict ? <>{syncError} <button onClick={() => window.location.reload()}>Reload</button></> : <>
                      {syncError} Your current readings remain on this page.{" "}
                      <button disabled={busy} onClick={() => finishing ? void finish() : void sync()}>Retry save</button></>}
                    </div>
                  )}
                  {!fresh && (
                    <div className="warning" role="alert">
                      No valid movement stream. Repetition counting and the
                      timer are paused.
                      <button
                        disabled={usb.busy || usb.connected}
                        onClick={() => void usb.connect()}
                      >
                        {usb.connected
                          ? "Check your sensor firmware"
                          : "Reconnect Arduino"}
                      </button>
                    </div>
                  )}
                  {usb.error && <div className="warning">{usb.error}</div>}
                  <div className="live-layout">
                    <div className="rep-panel">
                      <div className="live-reps">
                        {session.setPlan?.counts.at(-1) ?? session.reps}
                        <small> / {session.setPlan?.repsPerSet ?? session.target}</small>
                      </div>
                      <p className="center-note">{session.setPlan ? "Reps this set" : "Session repetitions"}</p>
                      {session.setPlan && <p className="center-note">{setSummary(session)} · {session.reps} total reps</p>}
                      <div className="thin-progress"><i style={{ width: Math.min(100, progressPercent(session)) + "%" }} /></div>
                      {(session.setPlan ? creditedSets(session.setPlan, session.target) * session.setPlan.repsPerSet >= session.target : session.reps >= session.target) ? (
                        <div className="notice">Target reached. You can finish your exercise.</div>
                      ) : session.setPlan && session.setPlan.counts.at(-1)! >= session.setPlan.repsPerSet && (
                        <div className="notice">Set credited. Press black to pause, then press again to begin the next set.</div>
                      )}
                      <div className="live-metrics">
                        <div>
                          <Activity size={19} />
                          <strong>
                            {fresh ? usb.reading?.setReps : "—"} <small>on tracker OLED</small>
                          </strong>
                        </div>
                        <div>
                          <Clock size={19} />
                          <strong>{duration(session.seconds)}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="heart-panel">
                      <h3>Equipment sensor placement</h3>
                      <div className="chart-empty">
                        <Radio size={24} />
                        <p>Attach the tracker to the moving equipment. Press black to pause the set. Press it again and hold still to start a new set. Finish &amp; save closes the website session.</p>
                      </div>
                      <p className="muted">Press the black button to pause the tracker. Press again and hold still to start a new set.</p>
                    </div>
                  </div>
                  <div className="live-footer">
                    <span className="muted">
                      {lastSaved
                        ? "Saved " + new Date(lastSaved).toLocaleTimeString()
                        : "Auto-save every 3 seconds"}
                    </span>
                    <div className="modal-actions">
                      {!running && !finishing && <button className="secondary" disabled={busy || !sensorReady} onClick={resume}>
                        Continue from current tracker count
                      </button>}
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void finish()}
                      >
                        <Check size={16} /> {busy ? "Saving…" : "Finish & save"}
                      </button>
                    </div>
                  </div>
                </section>
              ) : (
                <div className="empty-panel">
                  <Activity size={35} />
                  <h3>Ready when you are</h3>
                  <p>
                    Select a prescribed exercise and connect your sensor to
                    begin.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setTab("My exercises")}
                  >
                    View my exercises <ArrowRight size={16} />
                  </button>
                </div>
              ))}
            {tab === "Device connection" && !clinician && (
              <div className="device-grid">
                <section className="panel">
                  <span className="device-symbol">
                    <Radio size={30} />
                  </span>
                  <h2>Arduino UNO R4 Minima</h2>
                  <p>USB connection · 115200 baud</p>
                  <button
                    className="primary"
                    disabled={usb.busy}
                    onClick={() =>
                      usb.connected ? void usb.disconnect() : void usb.connect()
                    }
                  >
                    {usb.busy
                      ? "Connecting…"
                      : usb.connected
                        ? "Disconnect Arduino"
                        : "Connect Arduino via USB"}
                  </button>
                  {usb.error && (
                    <div className="warning" role="alert">
                      {usb.error}
                    </div>
                  )}
                  {!session && pendingExercise && (
                    <button className="secondary" disabled={!sensorReady || busy} onClick={() => void start(pendingExercise)}>
                      Start {pendingExercise.name}
                    </button>
                  )}
                  {sensorReady && (session || !pendingExercise) && (
                    <button className="secondary" onClick={() => setTab(session ? "Live session" : "My exercises")}>
                      {session ? "Return to live session" : "Choose an exercise"}
                    </button>
                  )}
                  <div className="device-line">
                    <span>Tracker state</span>
                    <span className="soft-tag">
                      {fresh ? usb.reading?.state : usb.connected ? "Waiting for tracker" : "Disconnected"}
                    </span>
                  </div>
                  <div className="device-line">
                    <span>Current set reps</span>
                    <span className="soft-tag">
                      {fresh
                        ? usb.reading?.setReps
                        : "Unavailable"}
                    </span>
                  </div>
                  <div className="device-line">
                    <span>Last valid packet</span>
                    <span className="muted">
                      {usb.lastSeen
                        ? new Date(usb.lastSeen).toLocaleTimeString()
                        : "None yet"}
                    </span>
                  </div>
                  {usb.connected && usb.stale && (
                    <div className="warning">
                      No fresh valid packets. Check sensor firmware and cable
                      connection.
                    </div>
                  )}
                  <p className="muted">
                    Start each exercise with the tracker at 0 reps (press black twice to begin a fresh set). The website set then matches the OLED, and each tracker set earns at most one set credit.
                  </p>
                </section>
                <section className="panel">
                  <h2>Before you begin</h2>
                  <ol className="setup-steps">
                    <li>Connect the UNO R4 Minima with a USB data cable.</li>
                    <li>
                      Close Arduino Serial Monitor so the website can use the
                      port.
                    </li>
                    <li>
                      Open this site in a desktop browser that supports Web
                      Serial, such as Chrome or Edge.
                    </li>
                    <li>
                      Secure the sensor to the moving equipment—not to the
                      patient. Use a ball, weight, bar, or approved cable
                      attachment.
                    </li>
                    <li>
                      Connect the board and wait for valid sensor readings.
                    </li>
                  </ol>
                  <p>
                    Upload the tracker sketch to the UNO R4 Minima using Arduino IDE.
                  </p>
                  <a
                    className="secondary"
                    href="/arduino/RehabConnect_Tracker/RehabConnect_Tracker.ino"
                    download
                  >
                    <Download size={16} /> Download tracker sketch
                  </a>
                  <p className="muted">
                    The current build measures equipment movement only and does
                    not use a pulse oximeter.
                  </p>
                </section>
                <section className="panel">
                  <h2>Connection feedback</h2>
                  <p>
                    Missing, repeated, or invalid packets are ignored. The timer
                    pauses when movement readings are unavailable. After reconnecting, select Continue to resume from the current board count.
                  </p>
                </section>
              </div>
            )}
            {tab === "Account settings" && (
              <div className="device-grid">
                <section className="panel">
                  <h2>Your profile</h2>
                  <p>
                    {profile.email} ·{" "}
                    {clinician ? "Physiotherapist" : "Patient"}
                  </p>
                  <form
                    className="profile-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await mutate(
                        {
                          action: "profile",
                          name: new FormData(e.currentTarget).get("name"),
                        },
                        "Profile updated.",
                      );
                    }}
                  >
                    <label>
                      Name
                      <input
                        name="name"
                        defaultValue={profile.name}
                        minLength={2}
                        maxLength={100}
                        required
                      />
                    </label>
                    <button disabled={busy} className="primary">
                      Save changes
                    </button>
                  </form>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={largeText}
                      onChange={(e) => {
                        setLargeText(e.target.checked);
                        try { if (preferenceKey) localStorage.setItem(preferenceKey, String(e.target.checked)); }
                        catch { /* The preference still applies for this visit. */ }
                      }}
                    />{" "}
                    Larger text
                  </label>
                  <SignOutButton className="secondary" beforeSignOut={saveBeforeSignOut}/>
                </section>
                {!clinician && (
                  <section className="panel">
                    <h2>Your physiotherapist</h2>
                    {data.therapist ? (
                      <div className="care-person">
                        <span className="avatar">{data.therapist.name[0]}</span>
                        <div>
                          <strong>{data.therapist.name}</strong>
                          <p>{data.therapist.email}</p>
                        </div>
                      </div>
                    ) : (
                      <p>
                        Your physiotherapist adds you using the email you signed up with:{" "}
                        <strong>{profile.email}</strong>. Your exercises appear here once they assign them.
                      </p>
                    )}
                  </section>
                )}
                <section className="panel">
                  <h2>Account security and records</h2>
                  <p>
                    RehabConnect manages this account. Self-service password
                    recovery is unavailable. Records are saved in the application database and
                    access is checked on the server for every request.
                  </p>
                  <p>
                    Only you and the physiotherapist who added you can
                    access your exercise records. Role changes are not available
                    through the workspace.
                  </p>
                  <p className="muted">
                    This ECE198 project tracks exercise activity. It does not
                    diagnose conditions, verify correct technique, or provide
                    emergency monitoring.
                  </p>
                </section>
              </div>
            )}
            <footer>
              <span>
                <Activity size={14} /> RehabConnect · Connected recovery
              </span>
              <span>ECE198 Group 2 · USB sensor monitoring</span>
            </footer>
          </main>
        </div>
        {detail && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="detail-title"
            >
              <button
                className="close"
                aria-label="Close exercise details"
                onClick={() => setDetail(null)}
              >
                <X />
              </button>
              <div className="detail-art">
                <Dumbbell aria-hidden="true" />
              </div>
              <h2 id="detail-title">{detail.name}</h2>
              <p>{detail.instructions}</p>
              <span className="soft-tag">
                {detail.sets} sets × {detail.reps} repetitions
              </span>
              <p className="muted">
                Follow your physiotherapist’s demonstrated technique.
                Illustration is decorative.
              </p>
              {!clinician && (
                <button
                  className="primary full"
                  disabled={busy}
                  onClick={() => void start(detail)}
                >
                  <Play size={16} /> Start exercise
                </button>
              )}
            </section>
          </div>
        )}
        {editor && (
          <div className="modal-backdrop">
            <section
              className="modal wide-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="editor-title"
            >
              <button
                className="close"
                aria-label="Close prescription editor"
                onClick={() => setEditor(null)}
              >
                <X />
              </button>
              <h2 id="editor-title">
                {editor.id ? "Update prescription" : "Assign an exercise"}
              </h2>
              <form
                className="prescription-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const result = await mutate(
                    {
                      action: editor.id ? "update-prescription" : "prescribe",
                      id: editor.id,
                      patientId: editor.patientId,
                      name: f.get("name"),
                      instructions: f.get("instructions"),
                      reps: Number(f.get("reps")),
                      sets: Number(f.get("sets")),
                      minutes: Number(f.get("minutes")),
                    },
                    "Prescription saved.",
                  );
                  if (result) setEditor(null);
                }}
              >
                {!editor.id && (
                  <label>
                    Start with an exercise
                    <select
                      value={editor.name}
                      onChange={(e) => {
                        const item = catalog.find(
                          (c) => c.name === e.target.value,
                        );
                        if (item)
                          setEditor({ ...item, patientId: editor.patientId });
                      }}
                    >
                      {catalog.map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Exercise name
                  <input
                    key={"name" + editor.name}
                    name="name"
                    defaultValue={editor.name}
                    minLength={2}
                    maxLength={150}
                    required
                  />
                </label>
                <label>
                  Instructions
                  <textarea
                    key={"instructions" + editor.name}
                    name="instructions"
                    defaultValue={editor.instructions}
                    minLength={10}
                    maxLength={3000}
                    rows={4}
                    required
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Repetitions
                    <input
                      key={"reps" + editor.name}
                      name="reps"
                      type="number"
                      min={1}
                      max={200}
                      defaultValue={editor.reps}
                      required
                    />
                  </label>
                  <label>
                    Sets
                    <input
                      key={"sets" + editor.name}
                      name="sets"
                      type="number"
                      min={1}
                      max={20}
                      defaultValue={editor.sets}
                      required
                    />
                  </label>
                  <label>
                    Est. minutes
                    <input
                      key={"minutes" + editor.name}
                      name="minutes"
                      type="number"
                      min={1}
                      max={120}
                      defaultValue={editor.minutes}
                      required
                    />
                  </label>
                </div>
                <p className="muted">
                  Changes apply to new sessions. Existing session targets are
                  preserved.
                </p>
                {error && (
                  <div className="warning" role="alert">
                    {error}
                  </div>
                )}
                <button className="primary full" disabled={busy}>
                  {busy ? "Saving…" : "Save prescription"}
                </button>
              </form>
            </section>
          </div>
        )}
        {selected && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="results-title"
            >
              <button
                className="close"
                aria-label="Close session details"
                onClick={() => setSelected(null)}
              >
                <X />
              </button>
              <span className="device-symbol">
                <Activity size={28} />
              </span>
              <h2 id="results-title">{selected.exercise}</h2>
              <p>{new Date(selected.startedAt).toLocaleString()}</p>
              <span
                className={
                  "status " + (selected.status === "completed" ? "success" : "")
                }
              >
                {label(selected)}
              </span>
              <div className="result-grid">
                <div>
                  <strong>
                    {setSummary(selected)}
                  </strong>
                  <span>
                    {progressPercent(selected)}% of
                    target
                  </span>
                </div>
                <div>
                  <strong>{duration(selected.seconds)}</strong>
                  <span>exercise time</span>
                </div>
              </div>
              {selected.setPlan && <p>{selected.reps} total reps · {selected.setPlan.repsPerSet} prescribed per set · Recorded set reps: {selected.setPlan.counts.join(", ")}</p>}
              <p className="muted">
                Equipment movement count · Updated{" "}
                {new Date(selected.updatedAt).toLocaleTimeString()}
              </p>
              {isOpen(selected) && (
                <p className="muted">
                  This session is not finalized. Readings refresh automatically
                  every 5 seconds.
                </p>
              )}
              <button
                className="primary full"
                onClick={() => setSelected(null)}
              >
                Back to workspace <ArrowRight size={16} />
              </button>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
