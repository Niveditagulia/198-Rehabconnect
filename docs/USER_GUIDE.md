# RehabConnect: how to use it

## Physiotherapist

1. **Register:** choose "Physiotherapist", fill in name, email and password, and enter the team's invite code.
2. **Add a patient:** Patient reports → "Add a patient by email" → type the email the patient registered with → **Add patient**.
   (The patient must register first.)
3. **Assign an exercise:** Assign exercises → pick the patient → **Assign exercise** → choose the exercise and set
   reps per set, sets and minutes → **Save prescription**. Use **Edit targets** or **Archive** later. Edits apply to new sessions only.
4. **Review results:** Patient reports / session history. Each session shows "x / y sets completed" and the reps in each set,
   e.g. `8, 8, 8, 8`. Older sessions show total reps. **Export** downloads the records as JSON.

## Patient

1. **Register:** choose "Patient", fill in name, email and password. Tell your physiotherapist which email you used.
   There is nothing else to do: your exercises appear once they're assigned.
2. **Connect the tracker** (desktop Chrome or Edge, USB data cable, Arduino Serial Monitor closed):
   Device connection → **Connect Arduino via USB** → choose the Arduino's port → wait for **running**.
3. **Start:** make sure the OLED shows **0** (if not, press black, press black again, hold still).
   My exercises → **Start exercise**.
4. **Exercise:** do the reps for one set. The website shows "reps this set / target" and the sets completed.
5. **Next set:** press **black** (pause), press **black** again and **hold still** while it calibrates, until the OLED shows 0.
   Do the next set.
6. **Finish:** **Finish & save**. Your physiotherapist sees the same result.

**Rules:** a set counts when **one** tracker set reaches the prescribed reps. Extra reps in one set don't fill another set.
32 reps without pressing black = 1 set.

**If something goes wrong:**
- The website says the stream was lost: reconnect, make sure the OLED shows 0 (press black twice), then **Continue from current tracker count**.
- You pressed white RESET: the board restarts at 0. Reconnect and press **Continue**. The earlier reps stay saved as their own set.
- "The tracker shows reps from before this session": press black, press black again, hold still, then try again.
- "This session changed in another tab": use only one tab for exercising. Click **Reload**.

## Tracker buttons

| Button | What it does |
|---|---|
| Black (first press) | Pauses; the OLED shows "PAUSED" and the last set's reps |
| Black (second press) | Recalibrates (hold still) and starts a new set at 0 |
| White (RESET) | Restarts the board; it doesn't save or end the website session |
| Blue LED flash | One rep counted |
