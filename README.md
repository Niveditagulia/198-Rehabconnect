# RehabConnect — Vercel edition

This folder is the complete Next.js application to import into Vercel. It includes the nine updated equipment exercises, Arduino UNO R4 Minima USB monitoring, patient reports, assignments, and separate patient/physiotherapist login and registration.

## Run on your computer

```sh
cd /Users/Nivedita/Desktop/198/rehabconnect-vercel
npm ci
npm run db:setup
npm run dev
```

Open http://localhost:3000. A local `.env.local` has already been generated with random development secrets and a local database URL. Open that file to find `THERAPIST_INVITE_CODE` when creating your physiotherapist account. No real user account is pre-created; use **Create an account** to register your email and a password of at least 12 characters.

Patient and physiotherapist accounts are separate. You may register the same email for both account types; the physiotherapist account additionally requires the invitation code. Select the account type you registered when logging in. A patient session cannot switch into the clinician workspace.

## Deploy to Vercel with Supabase

1. Open the target Supabase project's SQL Editor and run `supabase/migrations/001_rehabconnect.sql`.
2. Import this folder into Vercel as a Next.js project. Connect the Supabase integration to that project or set `POSTGRES_URL` in Vercel to the project's PostgreSQL transaction pooler connection string with TLS enabled.
3. Set `AUTH_SECRET` and `THERAPIST_INVITE_CODE` in the same Vercel environment. Generate separate random values with `openssl rand -hex 32`.
4. Deploy and register at `/register`. The app uses its existing email/password login with Supabase PostgreSQL storage. Local development uses SQLite when neither PostgreSQL URL is set.

## Role protection

- `/patient` and `/physiotherapist` check the authenticated role on the server. Opening the other role's URL redirects to the signed-in user's own workspace.
- `/api/app` verifies the session against the account and database on every request, then checks the requested role. Query strings, client headers, and edited tokens do not grant clinician permissions.
- The patient dashboard has no clinician workspace link. Creating a physiotherapist account requires the owner-controlled invitation code; the patient's existing account never changes role.
- Passwords use salted scrypt hashes. Sessions use signed, HTTP-only, SameSite cookies with Secure enabled in production and seven-day expiry. Logout revokes the database session before returning to `/login`.
- Both authentication and application writes enforce same-origin requests. Login attempts are limited per email in the database.
- A physiotherapist can see reports and assign exercises only for patients who have confirmed their care code connection.

Email/password authentication here is independent of ChatGPT. Existing ChatGPT-site passwords, profiles, and patient records are not automatically migrated. There is no email verification or self-service password recovery in this package.

## Checks

```sh
npm run build
npm start
# In another terminal, while the local server is running:
npm run test:integration
```

The integration test uses synthetic accounts on localhost and checks both logins, role isolation, direct URL access, forged headers/tokens, logout/re-login, care consent, prescription assignment, patient reports, concurrent session updates, and access revocation. Use a development database for tests.

## USB hardware

Connect the UNO R4 Minima at 115200 baud using desktop Chrome or Edge over HTTPS or localhost. Attach the sensor to the moving equipment. Upload the included `public/arduino/RehabConnect_Tracker/RehabConnect_Tracker.ino` with Arduino IDE (Renesas UNO core, Adafruit GFX and SSD1306). Close Serial Monitor before selecting the port in the patient dashboard. The browser sends HELLO followed by a space and a connection UUID. The tracker echoes that UUID in newline-delimited JSON snapshots. The website counts changes in the board's cumulative rep count during a session. Press the black button to pause or start a new set. After a USB interruption, explicitly continue from a fresh baseline. Check five reps in one set plus three in a second set against a saved session total of eight.

The original hosted ChatGPT Site and its database have not been changed by this export.
