# PPL Tracker — build spec

> **What this file is.** The full specification the app was built from (10/11/2026): every rule, screen and contract that was agreed before code was written, plus the additions approved along the way (§14–§16). Sections were written as instructions to the people building it, so they read as "must"/"do".
>
> **Source of truth.** The code and the tests implement this spec. A few details were refined during the final independent review; those are listed in [`DECISIONS.md`](DECISIONS.md) under "Changes after review". Where this file and `DECISIONS.md` differ, `DECISIONS.md` and the tests win.

An offline iPhone home-screen web app (PWA) to log and track the r/Fitness
"A Linear Progression Based PPL Program for Beginners" (Metallicadpa PPL).
Personal use. No server, no accounts, **no network calls of any kind**. All data
lives in the phone's browser storage; backup = export a CSV file, restore = import it.

Project root: the repository root (see [`../README.md`](../README.md) for the layout).

## 1. Hard constraints

- Plain HTML/CSS/JavaScript ES modules. No frameworks, no build step, **no npm dependencies**, no CDN, no web fonts, no external requests of any kind. Must work in airplane mode after first load.
- Deployable folder is `public/` (static files only). It will be hosted on Cloudflare Pages (HTTPS).
- Target: iPhone Safari iOS 17+, added to Home Screen (standalone). Must also run in desktop Chrome for testing.
- **Units:** kg default, lb selectable.
- **Dates:** shown everywhere as `DD/MM/YYYY`. Stored as ISO `YYYY-MM-DD` strings (local calendar date, no time). Never use `toISOString()` for "today" (UTC shift — in India before 05:30 it gives yesterday). Build dates from local getters; do date arithmetic via `new Date(y, m-1, d, 12)` (noon) so DST can't shift the day.
- Numeric dates typed by the user are **always day-first** (`10/11/2026` = 10 November 2026).
- Tests: Node built-in runner, `npm test` (= `node --test 'tests/*.test.js'`) from project root (Node 24; a bare directory argument does not work on Node 24). Root `package.json` is exactly:
  `{"name":"workout-tracker","private":true,"type":"module","scripts":{"test":"node --test 'tests/*.test.js'"}}` — no dependencies, ever.
- Pure modules (everything except `app.js`) must not touch DOM / `window` / `localStorage` at import time, so Node can import them. `store.js` takes the storage object as a parameter.
- No `alert` / `confirm` / `prompt` anywhere — use in-app confirm sheets.
- Escape all user text inserted into HTML (custom exercise names, notes) via one shared `escapeHtml`.
- SOLID/DRY: program rules live only in `program.js`; increments/rounding/conversion only in `units.js`; date logic only in `dates.js`. One formatter each for weights and dates, used everywhere.
- Style: small pure functions, JSDoc on exported functions, no classes needed, no console noise.

## 2. Layout

```
workout-tracker/
  package.json
  tests/*.test.js            (import from '../public/js/<module>.js')
  public/
    index.html
    manifest.webmanifest
    sw.js
    icons/apple-touch-icon.png (180), icon-192.png, icon-512.png
    css/app.css
    js/dates.js  units.js  program.js  progression.js  parser.js
       csv.js  store.js  analysis.js  charts.js  app.js
```

## 3. The program (`program.js` is the single source of truth)

### 3.1 Days and rotation

Day ids: `pullA`, `pushA`, `legs`, `pullB`, `pushB`.
Display names: `Pull A`, `Push A`, `Legs`, `Pull B`, `Push B`.
Rotation: Pull A → Push A → Legs → Pull B → Push B → Legs → repeat. Rest days are whenever; the app never schedules weekdays.
`DAY_ORDER = ['pullA','pushA','legs','pullB','pushB']`, `ROTATION = ['pullA','pushA','legs','pullB','pushB','legs']`.

**The cycle is driven by logged workouts, never by the calendar.** The user trains in order and skips calendar days whenever (gym closed, busy, rest). A skipped day changes nothing: the next workout offered is always the one after the last *logged* workout. There are no "missed workout" warnings, streak penalties or date-based schedules anywhere in the app.

Workouts are numbered **Day 1–6** within the cycle: pullA = 1, pushA = 2, legs = 3 or 6, pullB = 4, pushB = 5. Legs is one workout definition used twice (same exercises, same swaps). A legs session is Day 3 when the latest non-legs session before it is pullA or pushA, and Day 6 when it is pullB or pushB (no earlier non-legs session → Day 3).

### 3.2 Main lifts (role `main`; fixed, never swappable; rest 3–5 min)

| Day | Main lift | Sets | Planned sets N |
|---|---|---|---|
| pullA | Deadlift | 1×5+ (one AMRAP set) | 1 |
| pullB | Barbell row | 4×5, 1×5+ | 5 |
| pushA | Bench press | 4×5, 1×5+ | 5 |
| pushB | Overhead press | 4×5, 1×5+ | 5 |
| legs | Squat | 2×5, 1×5+ | 3 |

Target reps 5 on every set; the last set is AMRAP ("5+", as many good-form reps as possible).

### 3.3 Accessory slots (role `accessory`; rest 1–3 min)

Every accessory slot is swappable: its listed options **plus "Custom…"** (any free-text name). Options come from the Reddit post's substitution section.

PULL (same slots on pullA and pullB):

| slotKey | Label | Prescription | Options (first = default) | compound |
|---|---|---|---|---|
| pull.vertical | Vertical pull | 3×8–12 | Lat pulldown, Pull-up, Chin-up | yes |
| pull.row | Row | 3×8–12 | Seated cable row, Chest-supported row, Dumbbell row, T-bar row | yes |
| pull.rear | Rear delts | 5×15–20 | Face pull · **combo option** "Rear delt fly + Band pull-apart" (post: replace face pulls with BOTH, not one — produces two exercises, each 5×15–20, done as a superset with each other) | no |
| pull.curl1 | Curl | 4×8–12 | Hammer curl, then the other curls | no |
| pull.curl2 | Curl | 4×8–12 | Dumbbell curl, then the other curls | no |

Curl options (both slots, default first as above): Hammer curl, Dumbbell curl, Barbell curl, EZ-bar curl, Cable curl, Preacher curl, Incline dumbbell curl, Concentration curl.

PUSH:

| slotKey | Label | Prescription | Options | compound | superset |
|---|---|---|---|---|---|
| pushA.press (pushA only) | Overhead press | 3×8–12 | Overhead press — fixed, NOT swappable ("do the opposite press") | yes | |
| pushB.press (pushB only) | Bench press | 3×8–12 | Bench press — fixed, NOT swappable | yes | |
| push.incline | Incline press | 3×8–12 | Incline dumbbell press, Landmine press | yes | |
| push.tri1 | Triceps | 3×8–12 | Triceps pushdown, Overhead triceps extension, Skullcrusher, Lying triceps extension, Dumbbell triceps extension | no | with push.side1 |
| push.side1 | Side delts | 3×15–20 | Lateral raise, Front raise | no | with push.tri1 |
| push.tri2 | Triceps | 3×8–12 | Overhead triceps extension (default), then the same triceps list | no | with push.side2 |
| push.side2 | Side delts | 3×15–20 | Lateral raise, Front raise | no | with push.tri2 |

Order on pushA: Bench (main), pushA.press, push.incline, push.tri1, push.side1, push.tri2, push.side2. pushB: OHP (main), pushB.press, then the same.
(Front raise comes from OP's comment: "you could do 3 sets of front raises and 3 sets of lateral raises".)

LEGS:

| slotKey | Label | Prescription | Options | compound |
|---|---|---|---|---|
| legs.hinge | Hinge | 3×8–12 | Romanian deadlift (custom allowed) | yes |
| legs.quad | Quads | 3×8–12 | Leg press, Front squat | yes |
| legs.ham | Hamstrings | 3×8–12 | Leg curl, Glute-ham raise | no |
| legs.calf | Calves | 5×8–12 | Calf raise, Seated calf raise, Leg press calf raise | no |

ABS add-on (Plan toggle `abs`, off by default; post: "ab work on your deadlift days and your squat days"): when on, `pullA` and `legs` get two extra slots at the end:
`abs.1` options Ab wheel rollout (default), Plank · `abs.2` options Hanging leg raise (default), Plank, Ab wheel rollout. Each 3 sets, **no rep target** (`repsMin`/`repsMax` = null → no progression suggestion). For plank the reps field means seconds.

### 3.4 Goals (Plan setting `goal`, default `standard`; from the post's "modify to fit your goals" + "cutting" sections)

Applied by `getDayPlan` to accessory slots only (main lifts never change; abs never change):
- `standard` — as written.
- `strength` — compound slots become 3×4–6. Isolation unchanged.
- `endurance` — every accessory slot becomes 15–20 reps (sets unchanged).
- `cut` — every accessory slot with 3+ sets loses one set (3→2, 4→3, 5→4).
`GOALS`: array of `{id, label, description}` in that order.

### 3.5 Exercise catalog

`EXERCISES`: object keyed by id → `{id, name, group, category, aliases}`.
- `group`: `'pull' | 'push' | 'legs' | 'abs'`.
- `category` (drives increments): `deadlift` (Deadlift), `lower` (Squat), `upper` (Bench press, Barbell row, Overhead press), `accessory` (everything else — including Bench press / Overhead press when used in an accessory slot: increment by **role**, see §4).
- Ids (use exactly these): deadlift, barbellRow, bench, ohp, squat, latPulldown, pullUp, chinUp, cableRow, chestSupportedRow, dbRow, tbarRow, facePull, rearDeltFly, bandPullApart, hammerCurl, dbCurl, barbellCurl, ezCurl, cableCurl, preacherCurl, inclineCurl, concentrationCurl, inclineDbPress, landminePress, tricepsPushdown, ohTricepsExt, skullcrusher, lyingTricepsExt, dbTricepsExt, lateralRaise, frontRaise, rdl, legPress, frontSquat, legCurl, ghr, calfRaise, seatedCalfRaise, legPressCalfRaise, abWheel, plank, hangingLegRaise.
- Display names: Deadlift, Barbell row, Bench press, Overhead press, Squat, Lat pulldown, Pull-up, Chin-up, Seated cable row, Chest-supported row, Dumbbell row, T-bar row, Face pull, Rear delt fly, Band pull-apart, Hammer curl, Dumbbell curl, Barbell curl, EZ-bar curl, Cable curl, Preacher curl, Incline dumbbell curl, Concentration curl, Incline dumbbell press, Landmine press, Triceps pushdown, Overhead triceps extension, Skullcrusher, Lying triceps extension, Dumbbell triceps extension, Lateral raise, Front raise, Romanian deadlift, Leg press, Front squat, Leg curl, Glute-ham raise, Calf raise, Seated calf raise, Leg press calf raise, Ab wheel rollout, Plank, Hanging leg raise.
- Aliases (matched after normalisation — see `normalizeName`). At minimum:
  - deadlift: dl, deads, conventional deadlift
  - barbellRow: row, bb row, bent over row, bor, pendlay row
  - bench: bench, bp, flat bench
  - ohp: press, military press, shoulder press, standing press
  - squat: sq, back squat
  - latPulldown: pulldown, pull down, lat pull down, lpd
  - pullUp: pullup, pull up · chinUp: chinup, chin up
  - cableRow: cable row, seated row · chestSupportedRow: chest supported row, cs row · dbRow: db row, one arm row · tbarRow: t bar row, tbar row
  - facePull: facepull, fp · rearDeltFly: rear delt flye, reverse fly · bandPullApart: pull apart
  - hammerCurl: hammers · dbCurl: db curl, curl, bicep curl, biceps curl · ezCurl: ez curl, ez bar curl · inclineCurl: incline curl, incline db curl
  - inclineDbPress: incline db press, incline press, incline · landminePress: landmine
  - tricepsPushdown: pushdown, push down, tricep pushdown, rope pushdown · ohTricepsExt: overhead tricep extension, overhead extension, oh extension, oh ext · skullcrusher: skull crusher · lyingTricepsExt: lying tricep extension · dbTricepsExt: db triceps extension, db tricep extension
  - lateralRaise: lat raise, laterals, side raise · frontRaise: front raises
  - rdl: rdl, romanian · legPress: lp · frontSquat: fs · legCurl: hamstring curl, lying leg curl, seated leg curl · ghr: ghr, glute ham raise
  - calfRaise: calves, calf, standing calf raise · abWheel: ab wheel, rollout, ab rollout · hangingLegRaise: hlr, leg raise, leg raises
- Matching is **whole-string exact** on the normalised name (so `lat raise` ≠ `lat pulldown`, `dl` ≠ `rdl`). Display names match too.

### 3.6 `program.js` exports (contract)

- `EXERCISES`, `DAYS`, `DAY_ORDER`, `ROTATION`, `SLOTS`, `GOALS` (shapes as above; `DAYS[id] = {id, name, type:'pull'|'push'|'legs', main, mainSets, slots:[slotKey…]}`; `SLOTS[key] = {key, label, sets, repsMin, repsMax, compound, swappable, options:[{id, label, exercises:[exerciseId…]}], supersetWith: slotKey|null}`).
- `normalizeName(str)` → lowercase, every run of non-alphanumerics → one space, trimmed. (`"T-Bar  Row!"` → `"t bar row"`.)
- `matchExercise(name)` → exerciseId | null. Try the normalised string; if no hit, retry with a trailing `s` removed from the last word (`"face pulls"` → facePull, `"rdls"` → rdl, `"deadlifts"` → deadlift).
- `customId(name)` → `'custom:' + normalizeName(name)`. `isCustom(id)`.
- `exerciseName(exerciseId, fallbackName?)` → catalog display name, or fallbackName for custom ids.
- `roleOf(dayId, exerciseId)` → `'main'` if `DAYS[dayId].main === exerciseId`, else `'accessory'`.
- `mainSetsFor(exerciseId)` → 1 deadlift, 3 squat, 5 bench/ohp/barbellRow, `null` otherwise.
- `getDayPlan(dayId, {choices = {}, goal = 'standard', abs = false} = {})` →
  `{day, main: {exerciseId, sets: N, reps: 5}, items: [{slotKey, exerciseId, name, sets, repsMin, repsMax, compound, swappable, supersetWith}]}`.
  - `choices[slotKey]` is an option id or `'custom:<Display Name>'`; missing/unknown → default option.
  - A combo option yields **two** items with the same slotKey; each item's `supersetWith` = the other item's exerciseId.
  - For normal slots `supersetWith` = the exerciseId of the partner slot's resolved first exercise (e.g. push.tri1 ↔ push.side1), else null.
  - Custom choice → `exerciseId = customId(displayName)`, `name = displayName`.
  - Goal transforms per §3.4.
- `nextDay(sessions)` → dayId. Sort sessions by date ascending (stable). None → `pullA`. Last session's day: `pullA→pushA`, `pushA→legs`, `pullB→pushB`, `pushB→legs`, `legs→` look at the latest non-legs session: if it is pullA or pushA → `pullB`; if pullB or pushB → `pullA`; none → `pullA`.
- `cyclePosition(dayId, sessionsBefore)` → 1–6 per §3.1. `sessionsBefore` = the sessions logged before this one (any order; sort by date asc, stable). Non-legs days ignore `sessionsBefore`.
- `nextWorkout(sessions)` → `{dayId, position}` = `nextDay(sessions)` plus its `cyclePosition` given all `sessions` (e.g. last logged pushA → `{dayId:'legs', position:3}`; last logged pushB → `{dayId:'legs', position:6}`; last logged legs at position 6 → `{dayId:'pullA', position:1}`; none → `{dayId:'pullA', position:1}`).
- `parseDayText(text)` → `{type: 'pull'|'push'|'legs'|null, variant: 'A'|'B'|null, offDay: boolean}` from free text like `"Pull A"`, `"push b"`, `"Leg day"`, `"legs"`, `"pull (off day)"`, `"PushA"`, `"bad day"`. `offDay` true when text contains "off day", "bad day" or "(off)".
- `resolveDay(type, variant, exerciseIds)` → dayId | null:
  - type+variant given → that day (`legs` ignores variant).
  - `pull` without variant: contains deadlift → pullA; else contains barbellRow → pullB; else pullA.
  - `push` without variant: if both bench and ohp present, the one appearing **first** in exerciseIds is main (bench→pushA, ohp→pushB); only bench → pushA; only ohp → pushB; neither → pushA.
  - type null: majority `group` of the known exercises (ignore abs/custom; ties → first exercise's group), then apply the rules above; no known exercises → null.

## 4. Units (`units.js`)

- Increments: kg — upper 2.5, lower 2.5, deadlift 5, accessory 2.5. lb — upper 5, lower 5, deadlift 10, accessory 5.
- **Increment by role:** a main-role entry uses its lift's category (deadlift/lower/upper); any accessory-role entry uses `accessory`.
- Exports: `INCREMENTS`, `incrementFor(category, unit)`, `roundTo(value, step)` (nearest), `floorTo(value, step)` (round down, with a 1e-9 epsilon so float noise can't drop a step: `Math.floor(value/step + 1e-9) * step`, then clean float noise to 4 decimals), `convertWeight(w, from, to)` (KG_PER_LB = 0.45359237; result rounded to 0.25 for kg, 0.5 for lb; same unit → unchanged), `barWeight(unit)` → 20 kg / 45 lb, `formatWeight(w, unit)` → `"62.5 kg"`, `"100 kg"`, `"56.25 kg"`, `"135 lb"` (no trailing `.0`).

## 5. Progression (`progression.js`)

Session shape (see §8): `{id, date, day, offDay, note, entries:[{exerciseId, name?, sets:[{weight, reps}]}]}`. Role is derived (`roleOf(session.day, entry.exerciseId)`), never stored. Functions must sort input themselves (by date asc, stable) and must not mutate it.

- `entriesFor(sessions, exerciseId, role)` → `[{date, day, offDay, sets}]` ascending. Multiple entries of the same exercise+role in one session (e.g. Lateral raise in push.side1 and push.side2) are **combined** into one item with concatenated sets.
- `isMainSuccess(item, plannedSets)` → true iff `item.sets.length >= plannedSets` AND each of the first `plannedSets` sets has `reps >= 5`.
- `suggestMain(sessions, exerciseId, unit)` → `{weight, action, failStreak, last}`:
  - no history → `{weight: null, action: 'start', failStreak: 0, last: null}`.
  - `w` = max weight in the latest item.
  - latest is a success → `{weight: w + increment, action: 'increase', failStreak: 0}`.
  - otherwise compute `failStreak`: walk back from the latest item; **skip** items that are `offDay && !success`; count items that are `!success && maxWeight === w`; stop at the first success or different weight.
  - `failStreak >= 3` → `{weight: deloadWeight(w, exerciseId, unit), action: 'deload'}`; else `{weight: w, action: 'repeat'}` (this includes the off-day case).
- `deloadWeight(w, exerciseId, unit)` → `floorTo(w * 0.9, incrementFor(category, unit))`. Examples (kg): squat 100 → 90; bench 62.5 → 55; deadlift 140 → 125.
- `suggestAccessory(sessions, exerciseId, slot, unit)` where `slot = {sets, repsMin, repsMax}` → `{weight, action, last}`:
  - no history → `{weight: null, action: 'start', last: null}`.
  - `w` = max weight in the latest item.
  - `repsMin == null` → `action: 'none'`, weight w.
  - `last.sets.length >= slot.sets` and every set `reps >= repsMax` → `w + accessory increment`, `'increase'`.
  - any set `reps < repsMin` and not offDay → `max(0, w − accessory increment)`, `'decrease'`.
  - else → `w`, `'keep'`.
  - Weight 0 means bodyweight (pull-ups etc.); increase from 0 suggests added weight.
- `warmupSets(workWeight, unit)` → display-only warm-up ramp from the post: bar×10, then 50%×10, 70%×5, 90%×3 of the work weight, each rounded to the nearest increment (2.5 kg / 5 lb). Drop any ramp set ≤ bar or ≥ work weight, and duplicates. `workWeight` null → `[]`; work weight ≤ bar → `[{bar × 10}]`. Example kg 100 → `[20×10, 50×10, 70×5, 90×3]`.

## 6. Text import / export (`parser.js`)

- `parseImport(text, {unit = 'kg', today})` → `{sessions, warnings}`. `today` is an ISO date (defaults to `todayISO()`). Sessions have no `id`. Warnings are `{line, text, message}` with 1-based line numbers (tests should assert line numbers / counts, not wording).
- If the first non-empty line (after stripping a BOM) contains both `date` and `exercise` as header cells (comma or tab separated) → delegate to `parseCSV`.
- Otherwise text mode, line by line (`\r` stripped, trimmed, blank lines ignored — a session continues until the next header line):
  - **Header line** = a line that starts with a date (`parseDatePrefix`). The rest of the line goes to `parseDayText`. Day is resolved after the session's exercises are known (`resolveDay`); unresolvable → warning, session skipped.
  - Invalid date (e.g. `31/02/2026`) → warning; following lines are skipped until the next header.
  - `Note: …` line → `session.note`.
  - **Exercise line** = `<name> <sets>`. The name is the text before the first set token (a token starting with a digit, `bw`, or `x<digit>`/`×<digit>`); strip trailing `:` / `-` from the name. Known name → catalog id. Unknown → custom entry (`exerciseId = customId(name)`, `name` as typed, trimmed) **plus a warning**.
  - Exercise lines before any header → a session dated `today` (warning: no date line).
  - Repeated exercise names in a session → separate entries, in order.
- `parseSetTokens(str, {unit})` → `{sets, errors}`. Tokens separated by whitespace, `,`, `;` or `|`. Supported:
  - `WxR` with optional spaces and `x`/`X`/`×`/`*`: `100x5`, `100 x 5`, `100×5`, `100*5`, `62.5x5`.
  - Unit suffix on the weight: `100kg x 5`, `225lbx5`, `225 lbs x 5` → converted to `unit` via `convertWeight` when different.
  - Bodyweight: `bw x 8`, `bwx8`, `BW+10x8` (= weight 10, i.e. added weight), `bw` weight = 0.
  - Repeat: a lone `xN` / `×N` right after a set → repeat the previous set until the entry has N copies of it in a row (`45x12 x3` → three sets of 45×12; `20x20 x5` → five sets).
  - Sets@weight: `3x12@45`, `3 x 12 @ 45`, `5x5 @ 100kg` → S sets of R reps at W (only with `@`).
  - Same weight, more reps: a bare integer after a set → another set at the previous weight (`100x5, 5, 7` → 100×5, 100×5, 100×7); slash list `100x5/5/7` → same.
  - Commas are separators, never decimal points.
  - Anything unparseable → an error string (becomes a line warning); parseable sets are kept; a line with zero sets → entry skipped with a warning.
- `formatText(sessions, unit)` → human text in exactly the format above, sessions date-ascending, separated by a blank line:
  ```
  10/11/2026 Pull A
  Deadlift 100x7
  Lat pulldown 45x12 45x12 45x10
  Face pull 20x20 x5
  Note: slept badly
  ```
  Off day header: `10/11/2026 Pull A (off day)`. Identical consecutive sets are compressed with `xN` (N = total count). Weights printed without unit, without trailing `.0`. Custom exercises print their stored name.
  **Round trip:** `parseImport(formatText(s), {unit}).sessions` must equal `s` (ignoring `id`; `note` '' and `offDay` false when absent).

### Dates (`dates.js`)

- `todayISO(now = new Date())`, `addDays(iso, n)`, `formatDate(iso)` → `DD/MM/YYYY`, `weekStart(iso)` → ISO date of that week's **Monday**, `isValidISO(iso)`, `compareISO(a, b)`.
- `parseDatePrefix(line, {today})` → `null` if the line does not start with a date; `{date: null, rest, invalid: true}` if it looks like a date but isn't a real one; else `{date: iso, rest}` (`rest` = the remainder of the line, trimmed). Accepted (case-insensitive, optional leading weekday like `Tue`/`Tuesday,` ignored, optional ordinal suffix `10th`):
  - `D/M/YYYY`, `D-M-YYYY`, `D.M.YYYY`, `D/M/YY` (→ 20YY), `D/M` (no year) — **always day-first**.
  - `YYYY-MM-DD`.
  - `D Mon YYYY`, `D Month YYYY`, `D Mon`, `Mon D YYYY`, `Month D, YYYY`.
  - `today`, `yesterday` (relative to `today`).
  - Missing year → the year of `today`; if that date is after `today`, use the previous year.

## 7. CSV (`csv.js`)

- `CSV_HEADER = 'date,day,exercise,set,weight,reps,unit,off_day,note'`.
- `toCSV(sessions, unit)` → header + one row per set; `\n` line endings, trailing newline. date `DD/MM/YYYY`; day display name (`Pull A`…); exercise display name (custom → stored name); set 1-based within its entry; weight number without trailing `.0`; reps integer; unit `kg`/`lb`; off_day `yes` or empty; note repeated on every row of the session. RFC-4180 quoting (fields with `,` `"` or newline are quoted, quotes doubled). Sessions date-ascending, entries and sets in order.
- `parseCSV(text, {unit = 'kg'})` → `{sessions, warnings}`: accepts BOM, CRLF, comma **or tab** delimiter (detect from the header line), header columns in any order (by name, case-insensitive); only date, day, exercise, weight, reps are required. Dates `DD/MM/YYYY` or ISO. Day by display name or id (case-insensitive). Rows group into sessions by (date, day). Within a session a **new entry** starts when the exercise changes or the `set` number is ≤ the previous row's set number. Row unit different from `unit` → `convertWeight`. Bad rows → warning (1-based line number), skipped.
- Round trip: `parseCSV(toCSV(s, u), {unit: u}).sessions` equals `s` (ignoring `id`).

## 8. Store (`store.js`)

- `STORAGE_KEY = 'ppl-tracker-v1'`.
- `defaultState()` → `{version: 1, settings: {unit: 'kg', goal: 'standard', abs: false, lastBackupAt: null}, choices: {}, sessions: [], draft: null}`.
- `load(storage)` → state. Missing → default. Corrupt JSON → default, and the raw string is preserved under `STORAGE_KEY + '-corrupt-' + Date.now()` so nothing is lost. Partial objects → filled with defaults (`migrate`).
- `save(state, storage)`.
- `newId()` → unique string.
- `sessionKey(s)` → `s.date + '|' + s.day`.
- `mergeSessions(existing, incoming)` → `{sessions, added, replaced}`: an incoming session with the same key **replaces** the existing one (keeps the existing id); others are added with a new id; result sorted by date ascending (stable); inputs not mutated.
- `deleteSession(sessions, id)` → new array.
- `convertAllWeights(state, toUnit)` → new state, every set weight converted with `convertWeight`, `settings.unit = toUnit`; same unit → equal state.

## 9. Analysis (`analysis.js`)

- `e1rm(weight, reps)` (Epley): reps ≤ 0 → 0; reps 1 → weight; else `weight × (1 + reps/30)`, rounded to 0.1.
- `series(sessions, exerciseId, role)` → `[{date, topWeight, bestE1rm, volume}]` ascending (one per session; combined entries as in `entriesFor`). topWeight = max weight; bestE1rm = max e1rm over sets; volume = Σ weight×reps.
- `personalBests(sessions)` → `[{exerciseId, name, role, bestWeight, bestWeightDate, bestE1rm, bestE1rmDate}]` — one per (exerciseId, role); earliest date wins ties.
- `weeklyVolume(sessions)` → `[{weekStart, volume, count}]` ascending, Monday weeks, **zero-filled gaps** between the first and last week.
- `summary(sessions, today)` → `{total, thisMonth, last7, firstDate, lastDate}`; thisMonth = same calendar month and year as today; last7 = dates in `(today−7, today]`. Empty → zeros and nulls.
- `watchList(sessions, unit)` → for each of the 5 main lifts with history where `suggestMain` gives `failStreak ≥ 1` or action `deload`: `{exerciseId, weight, failStreak, action}`.
- `exercisesInData(sessions)` → unique `[{exerciseId, name, role}]`.

## 10. Charts (`charts.js`, pure → SVG strings)

- `lineChart({series: [{label, points: [{x: isoDate, y}]}], width = 340, height = 180, unit})` → `'<svg …>'`. Time-scaled x axis (dates as `DD/MM`), nice y ticks, a polyline/path per series with point dots, last value labelled, colours via CSS variables (`var(--c1)`, `var(--c2)`) so dark mode works, `role="img"` + `aria-label`. Empty series → an svg containing the text `No data yet`. Single point → still valid (no NaN anywhere in the output).
- `barChart({bars: [{label, value}], width, height, unit})` → same conventions.

## 11. UI (`app.js`, `index.html`, `css/app.css`)

Bottom tab bar, 5 tabs: **Today · Plan · Progress · History · Data**. Tap targets ≥ 44 px, iOS safe-area insets (`env(safe-area-inset-*)`), light + dark via `prefers-color-scheme`, system font. Weight inputs `inputmode="decimal"`, reps `inputmode="numeric"`.

**Today**
- Big heading **"Day 3 of 6 · Legs"** from `nextWorkout`. Date (defaults to today, editable, shown DD/MM/YYYY), day picker (defaults to `nextWorkout().dayId`; the user may pick any workout, and the cycle then carries on from whatever was logged), toggle "Off day (bad sleep/food) — misses won't count".
- Backup reminder banner when there are sessions and `lastBackupAt` is null or ≥ 7 days old: "Last backup: … — Export now" (links to Data).
- Main-lift card: name, "4×5, 1×5+ · rest 3–5 min", suggestion line — e.g. "Last: 100×5,5,5,5,7 on 07/11/2026 → add 2.5 kg today", "3 misses at 100 kg → deload to 90 kg", or first time: "Work up in sets of 5 until the bar slows, then take 2.5 kg off — that's your start." Warm-up line from `warmupSets`. Set rows: weight pre-filled with the suggestion (changing set 1's weight also updates later sets the user hasn't touched), reps empty with placeholder `5` / `5+`; the last set labelled AMRAP.
- Accessory cards: name + **Swap** button (sheet with the slot's options + Custom…; the pick saves to `choices` and applies to future sessions; past sessions keep what was logged), prescription + rest, superset label ("Superset with Lateral raise"), last-time line, suggestion ("Hit 3×12 → add 2.5 kg" / "Under 8 reps → drop 2.5 kg" / "Keep the weight"). Pre-filled weights, empty reps with range placeholder.
- Each card: + set / remove set. "+ Add exercise" (catalog picker or custom name) for extra isolation work.
- **Save workout**: keeps only sets with reps > 0; drops entries with no sets. Same date+day already saved → in-app confirm to replace. Toast "Saved Pull A · 10/11/2026", draft cleared.
- Draft autosave to `state.draft` on every change (debounced ~300 ms) and restore on open (iOS kills background home-screen apps).
- Editing an old session (from History) loads it into this form; Save replaces it. Suggestions for a date use only sessions **before** that date.

**Plan** — the full program as **Day 1 to Day 6** (Day 3 and Day 6 are both Legs, same content; a swap on one shows on both), then a line "Rest: whenever you like — the app follows the workouts you log, not the calendar." Each day with every exercise, sets×reps (after goal), supersets, rest; a Swap control on every swappable slot (main lifts + fixed presses show "main lift — fixed"). Goal selector with one-line descriptions. Abs toggle. A short rules card in plain words (add 2.5 kg upper/squat and 5 kg deadlift when all reps are hit; accessories: all sets at the top of the range → add weight, under the bottom → lower; 3 misses in a row → take 10% off; AMRAP = as many good-form reps as possible; starting weight guide; form + weight both matter).

**Progress** — summary tiles (total, this month, last 7 days, last workout). For each main lift (Squat, Bench press, Deadlift, Overhead press, Barbell row): line chart of working weight + estimated 1-rep max, current weight, change since first session ("+22.5 kg since 01/10/2026"), best e1RM; "No data yet" when empty. Exercise picker (everything in the data, incl. accessories/custom) → chart + last 10 sessions table. Weekly volume bar chart. Watch list ("2 misses at 100 kg — one more and it's deload time"). Personal bests table.

**History** — newest first: "Tue 10/11/2026 · Day 1 · Pull A" (Day number from `cyclePosition`), compact lines ("Deadlift 100×7 · Lat pulldown 45×12,12,10"), off-day tag; tap to expand; Edit / Delete (in-app confirm); filter chips All / Pull / Push / Legs.

**Data**
- Export backup (CSV): file `ppl-backup-DD-MM-YYYY.csv`; if `navigator.canShare?.({files})` → `navigator.share({files:[file]})` (iOS share sheet → Save to Files / AirDrop), else an `<a download>` fallback. On success `settings.lastBackupAt = today`.
- Copy as text: `formatText` → clipboard (fallback: show selectable textarea).
- Import: textarea "Paste workouts (text or CSV)" + Choose file (`accept=".csv,.txt,text/plain,text/csv"`). Preview → parsed sessions (date, day, exercises/sets) + warnings with line numbers + "N new, M will replace existing" → Import button → `mergeSessions` → save. Collapsible format help with examples.
- Settings: units kg/lb (switching → in-app confirm "Convert all saved weights to lb?" → `convertAllWeights`). Date format note (DD/MM/YYYY).
- Status: "Saved on this phone only · N workouts · Last backup DD/MM/YYYY". Call `navigator.storage?.persist?.()` once after the first save.
- Delete all data: must type `DELETE`.
- Install hint when not standalone (`!navigator.standalone && !matchMedia('(display-mode: standalone)').matches`): "In Safari tap Share → Add to Home Screen. After that it works offline."

## 12. PWA / offline

- `manifest.webmanifest`: name "PPL Tracker", short_name "PPL", `start_url "./"`, `scope "./"`, `display "standalone"`, theme/background colours, icons 192 + 512 PNG (purpose `any maskable`).
- `index.html`: viewport `width=device-width, initial-scale=1, viewport-fit=cover`; `apple-mobile-web-app-capable` + `mobile-web-app-capable` = yes; `apple-mobile-web-app-title` PPL; `apple-touch-icon` link; theme-color for light/dark; `<script type="module" src="js/app.js">`.
- `sw.js`: versioned cache name (`ppl-v1`), precache an explicit list of every file in `public/`; install → `addAll` + `skipWaiting`; activate → delete other caches + `clients.claim`; fetch → cache-first for same-origin GET, network fallback, navigation requests fall back to cached `index.html`. Register from app.js with a relative path (`./sw.js`).
- "Update ready — tap to reload" banner on `controllerchange` after the first install.
- Icons: generate PNGs locally without npm (e.g. write an SVG and rasterise with headless Chrome: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=<out> --window-size=512,512 <file.svg>`, or a tiny Node zlib PNG encoder). Simple dumbbell glyph on a solid colour; no transparency on the apple-touch-icon.

## 13. Out of scope

Accounts, sync, any network use, rest timer, notifications, git.

## 14. Set weight ("baselines") — added 10/11/2026, approved by the user

The user can set the weight for any exercise at any time. That weight is used **once**, for the next session of that exercise, and then the normal progression rules continue from what was actually lifted. It is not a workout: it never appears in History, charts, analysis or the CSV backup.

Example: squat 60 kg done → app plans 62.5. User sets 70. Next leg day Today pre-fills 70 ("Weight you set: 70 kg"). User lifts 70 and saves → the set weight is used up. Next leg day suggests 72.5.

### Logic (`progression.js`)
- `baselineKey(exerciseId, role)` → `` `${exerciseId}|${role}` `` (role matters: bench main ≠ bench accessory).
- `applyBaseline(suggestion, baseline)` → if `baseline` is missing, or `baseline.weight` is not a finite number ≥ 0 → returns `suggestion` unchanged. Otherwise returns a **new** object `{ ...suggestion, weight: baseline.weight, action: 'set' }`, and if the suggestion has a `failStreak` key it becomes `0`. `last` is kept. Works for both `suggestMain` and `suggestAccessory` results. Never mutates its inputs.
- The 3-misses rule needs no change: it counts misses at the same weight, so a new weight starts fresh by itself.

### State (`store.js`)
- `defaultState()` gains top-level `baselines: {}` and `settings.setupDone: false`.
- `migrate` keeps `baselines` entries whose `weight` is a finite number ≥ 0 (drops others); missing/non-object → `{}`. `settings.setupDone` defaults to `false`.
- `setBaseline(state, exerciseId, role, weight, today)` → new state with `baselines[baselineKey(exerciseId, role)] = { weight, setOn: today }`, replacing any earlier one. Invalid weight (not finite, < 0) → returns an equal copy of `state`, no throw. Never mutates `state`.
- `clearBaseline(state, exerciseId, role)` → new state without that key (no-op copy if absent).
- `consumeBaselines(state, session)` → new state with the baseline removed for every entry in `session.entries` that has at least one set with `reps > 0`, using `roleOf(session.day, entry.exerciseId)` for the role. Entries with no reps don't consume. Other baselines stay. Never mutates inputs.
- `convertAllWeights` also converts every baseline weight (same `convertWeight` rounding). A state with no `baselines` key gets none added.
- The CSV backup does not include baselines.

### UI (§11 additions)
- **Set weight** button on every Today exercise card, on every Plan exercise row, and on the Progress focus card. Opens a small sheet: number input (kg/lb), **Save**, and **Clear** (when one is set). Copy: "Used for your next session only. After that the app takes over again."
- When a suggestion's action is `'set'`, the card's suggestion line reads "Weight you set: 70 kg" and the set rows pre-fill that weight.
- **Saving a new workout in Today** calls `consumeBaselines` after the session is saved. Editing an existing session from History does **not** consume baselines. Import does not consume baselines.
- **First open:** when `settings.setupDone` is false and there are no sessions, show "Set your starting weights (you can skip)": the 5 main lifts with empty inputs, plus an expandable "Accessories" list of the current default picks. Save → `setBaseline` for each filled box; Skip → nothing. Both set `settings.setupDone = true`. A blank lift falls back to the existing first-time tip on the day. The same list is reachable later from Plan → "Set weights".

## 15. Import and swap refinements — approved by the user 10/11/2026

1. **Effort notes and a set cap (`parser.js`, `parseSetTokens`).**
   - `S x R @ W` applies only when `S ≤ 20`. When `S > 20` the left side is a weight × reps set instead: `100x5 @8` → one set 100×5, and an error string for the ignored `@8` (an effort score such as RPE). The same applies with or without spaces around `@`.
   - A single line can never produce more than **20 sets**. Anything beyond the first 20 is dropped with an error string (e.g. `20x5 x1000000` → 20 sets plus an error).
2. **The same workout twice in one paste (`parseImport`, text mode).** When two header blocks have the same date and resolved day, only the **later** block is returned, and a warning is added on the later block's header line. CSV is unchanged: rows of the same date and day already group into one session.
3. **Custom names that match a built-in exercise (`program.js`, `getDayPlan`).** For a choice `'custom:<Name>'`, if `matchExercise(Name)` finds a catalog exercise that is **not** one of the five main lifts (`MAIN_LIFTS`), the item uses that catalog id and its catalog display name. If it matches a main lift, or nothing, it stays a custom exercise as before (`customId(Name)`, name as typed). This keeps one history per real exercise without letting an accessory swap be counted as a main-lift session.
4. **Clarification (10/11/2026):** in `S x R @ W`, S must be a **whole number from 1 to 20** to count as a set count. Any other left side (over 20, a decimal like `12.5`, or `bw`) is a weight × reps set and the `@N` is an ignored effort note with an error string: `12.5x10 @8` → one set 12.5×10 + error; `bw x 8 @ 8` → one set 0×8 + error.
5. **UI note:** the Today "+ set" button stops at 20 sets per exercise, matching the import cap, so every logged workout survives a text backup → restore.

## 16. Screens — build contract (user approved the mocks on 10/11/2026)

### 16.1 Approved visual design (match these)
- Progress: [`docs/design/progress.html`](design/progress.html) — two views behind a switch at the top: **All charts** and **One at a time**. Open with `?view=all` / `?view=focus&focus=latPulldown` / `?theme=dark`.
- Today, Swap sheet, Plan, History, Data: [`docs/design/screens.html`](design/screens.html) (`?only=0..4` shows one screen, `?theme=dark`).
- Reuse the mocks' design tokens exactly (the `:root` CSS variables for light and dark, `system-ui` font, radii, spacing, the chip / seg / card / tile / sheet / tabbar styles). Chart colours: weight / working weight = `--s1` (blue), est. 1RM and total reps = `--s2` (orange). Hairline solid gridlines, 2px lines, 8px dots with a 2px surface ring, bars ≤ 24px with 4px rounded tops. Text never uses a series colour. Status colours only with an icon + label.
- The mocks use sample data; the app uses real data from the logic modules. Where a mock shows something the logic can't produce, follow the logic and say so in the report.

### 16.2 Screen behaviour (in addition to §11)
- **Today**
  - Heading text exactly `Day N of 6 · <Day name>` (from `nextWorkout`, or the chosen day). "Change date" (native date input; shown DD/MM/YYYY) and "Doing a different workout? Change" (a sheet listing Day 1–6).
  - Banner rules: backup reminder (§11); "Editing DD/MM/YYYY · <Day>" with "Cancel edit" when editing from History.
  - Card opening rule: the main lift and the first exercise that still has an empty reps box are open; an exercise with any reps entered stays open; any card opens when tapped; the rest show one line (name · prescription · suggestion headline).
  - Suggestion line by action (headline / detail):
    - main `increase`: "Add 2.5 kg today → 62.5 kg" / "Last time DD/MM: 60 kg × 5, 5, 5, 5, 7"
    - main `repeat`: "Same weight: 65 kg" / "1 miss in a row" (or "2 misses in a row — one more and it's deload time"; off-day: "Last time was an off day")
    - main `deload`: "Deload: take 10% off → 57.5 kg" / "3 misses in a row at 65 kg"
    - main `start`: "First time" / "Work up in sets of 5 until the bar slows, then take 2.5 kg off — that's your start."
    - any `set`: "Weight you set: 70 kg" / "Used for this session only"
    - accessory `increase`: "Add 2.5 kg today → 20 kg" / "Last time: every set at the top of 15–20"
    - accessory `keep`: "Keep 45 kg" / "Last time: 10, 9, 9 — 8 reps to go before adding weight"
    - accessory `decrease`: "Go lighter → 42.5 kg" / "Last time a set fell under 8 reps"
    - accessory `start`: "First time" / "Pick a weight you can do about 10 times with good form."
    - `none` (abs): "Any reps" / "" — increments shown use the user's unit.
  - Warm-up line on the main lift from `warmupSets`. "+ Set" stops at 20 sets; "− Set" never removes the last set.
  - Weight inputs pre-fill from the suggestion (`applyBaseline` applied first); reps inputs start empty with the range as placeholder. Input font ≥ 16px everywhere (stops iOS zoom).
  - Save: §11 rules, then `consumeBaselines` for new sessions only, then toast `Saved <Day name> · DD/MM/YYYY`, draft cleared, form moves to the next workout.
- **Set weight sheet** (Today cards, Plan rows, Progress focus card): title `Set weight: <Exercise>`, number input labelled `Weight (kg)` / `Weight (lb)`, buttons **Save** and **Clear** (Clear only when one is set), copy "Used for your next session only. After that the app takes over again."
- **First open**: when `settings.setupDone` is false and there are no sessions → dialog `Set your starting weights` with the 5 main lifts and an expandable "Accessories" list (current picks) — inputs labelled `<Exercise> starting weight`; buttons **Save** and **Skip**. Both set `setupDone`. Plan has a "Set weights" button that opens the same list later.
- **Plan**: goal seg, abs switch, Day 1–6 strip with the next workout highlighted, the 6 day cards (Day 3 and Day 6 are both Legs, shared content) collapsible with every exercise (prescription after goal, superset note, main lifts "Main · fixed"), a Swap button and a Set weight button on every swappable row (main lifts: Set weight only), "Set weights" button, rules card.
- **Swap sheet**: title `Swap: <slot label>`, the slot's options (combo shown as "Rear delt fly + Band pull-apart"), "Custom…" (text input + Save). Choosing saves to `choices` immediately and closes. A custom name that matches a catalog exercise is handled by `getDayPlan` (§15.3).
- **Progress**: exactly the approved mock, driven by `analysis.js`/`progression.js`. Exercise list = the current plan's exercises (with swaps) grouped Pull / Push / Legs (+ "Other" for exercises found only in the data); rows with no sessions show "No sessions yet". Accessory target line = current slot `sets × repsMax`. "Add 2.5 kg" tag when the last session hit the top on every planned set.
- **History**: §11 + month groups; delete asks in an in-app dialog.
- **Data**: §11 + the mock layout. Import preview shows "N new, M will replace existing" and every warning with its line number.
- **Banners**: install hint (not standalone), "Update ready — tap to reload" (service worker `controllerchange`).

### 16.3 Accessibility / test contract (the end-to-end tests rely on these names — keep them exact)
- Bottom tabs are `<button>`s named `Today`, `Plan`, `Progress`, `History`, `Data` inside `<nav aria-label="Sections">`; the active one has `aria-current="page"`.
- Every sheet/dialog: `role="dialog"`, `aria-modal="true"`, `aria-label` = its title. Closing: an explicit button (Done / Cancel / Save / Skip) and Escape.
- Today: each exercise card is `<section aria-label="<Exercise display name>">` (custom: the stored name). Inside, inputs `aria-label="Set N weight"` and `aria-label="Set N reps"` (N from 1), buttons named `Swap` (swappable only), `Set weight`, `+ Set`, `− Set`. The suggestion headline is an element with class `suggest-headline`. Main card has the text `Main lift`.
- Buttons: `Save workout`, `Change date`, `Change` (day picker), `Cancel edit`, `Export now` (banner).
- Toasts use `role="status"`.
- Off day switch: `<input type="checkbox" role="switch" aria-label="Off day">`. Abs: `aria-label="Ab work"`.
- Plan: goal buttons named `Standard`, `Strength`, `Endurance`, `Cutting` with `aria-pressed`; day cards `<section aria-label="Day N · <Day name>">`.
- Progress: view switch buttons `All charts`, `One at a time` (`aria-pressed`); range chips `4 weeks`, `3 months`, `All`; main-lift buttons `Squat`, `Bench`, `Dead`, `OHP`, `Row`; list rows are `<button>`s whose accessible name starts with the exercise name; every chart is an `<svg role="img">` with an `aria-label`.
- History: each workout `<article aria-label="<Ddd> DD/MM/YYYY · Day N · <Day name>">` with buttons `Edit` and `Delete`; filter chips `All`, `Pull`, `Push`, `Legs`.
- Data: buttons `Export backup (CSV)`, `Copy as text`, `Choose file`, `Preview`, a button whose name starts with `Import ` (e.g. `Import 3 workouts`), `Delete everything…`; textarea `aria-label="Paste workouts"`; delete dialog input `aria-label="Type DELETE"` and button `Delete`; unit buttons `kg` and `lb` (`aria-pressed`).
- Export with no `navigator.share` support falls back to an `<a download="ppl-backup-DD-MM-YYYY.csv">` click (tests rely on the fallback in headless Chrome).

### 16.4 Build notes
- Structure: `public/index.html`, `public/css/app.css`, `public/js/app.js` (boot, state, routing between tabs, save/load) plus small view modules in `public/js/ui/` (one per screen + shared `dom.js`, `sheets.js`, `chart-ui.js` for crosshair/tooltip). Pure modules stay pure; UI never re-implements a rule (suggestions, cycle, parsing, formatting all come from the logic modules).
- Charts: rewrite `charts.js` (still pure, SVG strings, still passing its tests) to produce the approved design; `chart-ui.js` adds the crosshair/tooltip/keyboard layer on top. Text inserted into SVG/HTML always escaped.
- `sw.js`: update the precache list to the real file list and bump the cache name (`ppl-v2`). Register `./sw.js` from app.js.
- `manifest.webmanifest`: colours from the design tokens (`#f9f9f7` light background / theme). Icons: dumbbell glyph, `--s1` blue background, white glyph; 180 (apple-touch, no transparency), 192, 512; generated locally (headless Chrome screenshot of an SVG), generator script in `tools/` (not deployed).
- Persist: `navigator.storage?.persist?.()` once after the first save.
- No network requests, no external assets, no inline event handler attributes, no `alert/confirm/prompt`.
