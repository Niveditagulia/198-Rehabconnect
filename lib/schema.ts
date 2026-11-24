export const schema = [
  `CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('patient','physiotherapist')), care_code TEXT UNIQUE, therapist_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS profile_therapist_idx ON profiles(therapist_id)`,
  `CREATE TABLE IF NOT EXISTS prescriptions (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES profiles(id), therapist_id TEXT NOT NULL REFERENCES profiles(id), name TEXT NOT NULL, instructions TEXT NOT NULL, reps INTEGER NOT NULL, sets INTEGER NOT NULL, minutes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS prescription_patient_idx ON prescriptions(patient_id)`,
  `CREATE TABLE IF NOT EXISTS exercise_sessions (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES profiles(id), prescription_id TEXT NOT NULL REFERENCES prescriptions(id), exercise TEXT NOT NULL, instructions TEXT NOT NULL, target INTEGER NOT NULL, reps INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER, heart TEXT NOT NULL DEFAULT '[]', connection TEXT NOT NULL DEFAULT 'disconnected', revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS session_patient_idx ON exercise_sessions(patient_id)`,
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY REFERENCES profiles(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('patient','physiotherapist')), password_hash TEXT NOT NULL, UNIQUE(email,role))`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS auth_session_account_idx ON auth_sessions(account_id)`,
  `CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 1, reset_at INTEGER NOT NULL)`,
];
