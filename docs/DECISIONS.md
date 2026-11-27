# Decisions

Product decisions made while planning and building the app (10/11/2026), and why. The spec ([`SPEC.md`](SPEC.md)) has the details. Where the two differ, this file and the tests win.

## The app

| Decision | Why |
|---|---|
| A home-screen web app (PWA), not an App Store app | No signup or install store; one codebase; works offline after the first load. |
| No accounts, no server, no network calls; data only in the phone's browser storage | Privacy and simplicity. Nothing to run or secure. |
| Backup = one CSV file through the share sheet (Save to Files / AirDrop); restore = import it. Plus "Copy as text" | The owner's backup without any cloud service. The CSV opens in Numbers too. |
| Hosted on Cloudflare Pages from a private GitHub repo, the owner's personal accounts | Free HTTPS (needed for offline mode). Push to `main` deploys. |
| No dependencies, no build step | Nothing to update or break; any static server can serve it. |

## Program and progression

| Decision | Why |
|---|---|
| kg by default; the lb switch converts every saved weight | The owner trains in kg. |
| Dates shown DD/MM/YYYY; typed numeric dates always day-first (`10/11` = 10 November) | Matches the owner's locale. No ambiguity. |
| **The cycle follows logged workouts, never the calendar.** Day 1–6 = Pull A, Push A, Legs, Pull B, Push B, Legs | Gym closed or busy? Skip the day; the next workout is still next. There are no "missed" warnings anywhere. |
| Doing a different workout than offered: the cycle carries on from what was logged | Never offers the same muscle group twice in a row. |
| Legs is one workout used twice (Day 3 and Day 6) | The post's legs day doesn't alternate. One definition, one set of swaps. |
| Swaps = the post's substitution list, plus custom names; the 5 main lifts stay fixed | As the post says: "everything here is interchangeable, except the main lifts". Face pulls swap to rear delt flyes **and** band pull-aparts together, as the post specifies. Front raises come from the author's reply in the comments. |
| Goals (strength / endurance / cutting), ab add-on, warm-up ramp, off-day switch | All from the post's own "modify to fit your goals", cutting, abs and warm-up sections. |
| **Set weight:** a weight the owner sets is used for that exercise's **next session only**, then the rules continue from what was lifted | Covers starting weights, a new gym, coming back after a break. Never fights the progression for long. |
| First open shows "Set your starting weights" (skippable) using the same feature; blank lifts show the post's "work up in sets of 5" tip on the day | One feature instead of two. The guided step-by-step finder was considered and dropped. |
| Accessory progress is charted as weight **and** total reps with a target line | Accessories add reps before weight; a weight-only chart looks flat while you improve. |

## Import rules

| Decision | Why |
|---|---|
| `100x5 @8` → 100 kg × 5, and the `@8` is ignored with a warning. `S x R @ W` means sets only when S is a whole number 1–20 | `@8` is a common effort (RPE) note, not "100 sets". |
| No line can make more than 20 sets; Today's "+ Set" also stops at 20 | Typos like `x1000000` can't flood the data, and every logged workout survives a text backup and restore. |
| The same workout twice in one paste: only the later copy is kept, with a warning | It's almost always a corrected re-paste. |
| A custom swap name that matches a built-in exercise ("hammer curls") becomes that exercise, except the 5 main lifts | Keeps one history per real exercise, without letting a light accessory set count as a main-lift session. |

## Design

| Decision | Why |
|---|---|
| Approved mocks: [`design/progress.html`](design/progress.html) and [`design/screens.html`](design/screens.html) | Designed and approved before the screens were built. |
| Progress has two views behind a switch, *All charts* and *One at a time*, inside the Progress tab (not a 6th tab) | The owner wanted both. Six tabs are cramped on a phone. |
| Blue = weight, orange = est. 1RM / total reps; checked for colour-blind readers in light and dark | Readable for everyone, consistent across charts. |
| App icon: a bold white dumbbell on a slant over blue (option A); the browser tab gets its own rounded 16/32 px icon (11/11/2026) | The first icon read as an "H" on the home screen and as a plain blue square in a tab. |
| **Save workout sits at the end of the workout page, after the Note box, not pinned to the bottom of the screen** (11/11/2026) | The owner's preference: nothing covers the exercises while logging. The draft autosaves anyway, and the e2e check `iphone-basics` guards the placement. |

## Changes after review

The independent review of the finished screens made these calls. They're the final behaviour:

| Decision | Why |
|---|---|
| History shows Edit / Delete only on the opened workout; the newest opens by itself | Matches the approved mock. |
| Editing a workout keeps its place and id, even with two workouts on one date | Editing used to reorder same-day workouts and shift the Day count. |
| An unsaved draft with no reps typed moves to today the next day; a draft with reps keeps its date | The reps were done that day, so they keep it. An empty form should be today's. |
| The share sheet is used on touch devices; desktops get a file download | Desktop share sheets can hang without UI. |
| All set rows are shown on Today (no collapsed "3 more sets"); an optional Note field was added | You type into every row at the gym; notes are already part of the backup formats. |
| The watch list shows misses and pending deloads only | That's what the logic produces. |
| Accessory presses are labelled "(8–12 reps)" | Keeps them apart from the same lift done heavy for 5s, which has its own history. |

## Batch 1 — owner feedback (20/11/2026)

Details in [`SPEC.md` §17](SPEC.md).

| Decision | Why |
|---|---|
| **An exercise done twice in a workout is two tracks** (exercise, role, occurrence): each Lateral raise on a Push day has its own history, suggestion, set weight and chart. The occurrence comes from the saved order, so old data needs no migration; the second track is named after its superset partner ("Lateral raise · with Overhead triceps extension") | The two lateral raises were merged, so both cards showed the heavier one's weight and the same advice. |
| **Each exercise has a weight step:** machines and cables go up and down 5 kg / 10 lb, everything else as before. The owner can set a step for any exercise (main lifts too) in its Set weight sheet; it stays until changed and deloads round down to it | Machine stacks don't move in 2.5 kg jumps, and some gyms have no small plates. |
| **Plank is timed:** the reps box holds seconds. Aim for the shortest hold + 5 s; 60 s on every set adds a plate on the back (the plank's step) and the target goes back to 30 s. Off days don't count. The other ab exercises stay "Any reps" | The owner wants holds to build up the same way reps do. |
| **Weights are the total, bar included.** Barbell cards say "Total weight" with a plate line ("= 20 kg bar + 21.25 kg each side"); machines say "Weight (stack)", dumbbells "Weight (each)", bodyweight "Added weight". The bar is a setting (Data → Settings, default 20 kg / 45 lb) used by the plate line and the warm-up | The owner asked whether weights meant the plates or the total. Labelling every card answers it once. |
| **Add exercise and Swap work with one tap on iPhone:** the Add sheet no longer opens the keyboard; typing filters the list and Enter / Go adds the single match or the typed name; the new card opens, scrolls into view and flashes, with a toast. Swap toasts "Swapped to …". Option rows are 48 px and keep the keyboard steady under the finger | On the phone the keyboard covered the list, the first tap only closed it, and nothing showed where the new card went. |

### Batch 1 — changes after the independent review (20/11/2026)

| Decision | Why |
|---|---|
| **The plate line shows only for a standard bar loaded on both ends.** EZ-bar curl and skullcrusher (an EZ bar) and landmine press (one end loaded) still say "Total weight" but show no plates | A 20 kg-bar line gave wrong loading: EZ-bar curl 27.5 kg read "20 kg bar + 3.75 kg each side", and a 17.5 kg skullcrusher read "Lighter than the bar". |
| **Plank after an off day:** when the last plank was on an off day, the card says "Last time was an off day — going by DD/MM: 40, 40, 40 s" | The target comes from the last normal day. Calling that day "last time" didn't match what the owner had just done. |
| **Plank holds read as seconds everywhere:** History and the import preview show "0 kg × 45, 45, 40 s", as Progress does | §17.3: the reps box holds seconds. |
| **The Add exercise search finds plurals** ("hammer curls" → Hammer curl), the same way typed names are matched | The list said "No match" for a name that Enter then added. |
| **Known limits, kept on purpose:** (1) a track follows the order you log: if only the second Lateral raise of a Push day is logged, it counts as the first (its history, and it uses up the first one's set weight); (2) switching kg ↔ lb converts the bar like any other weight (20 kg → 44 lb); type 45 in Data → Settings if your lb bar is 45 lb | (1) Backups store no slot, and the order rule keeps old data and backups working unchanged. Skipping the first superset and doing the second is rare. (2) Changing the units doesn't change the bar you own. |

## Batch 2 — owner approved (20/11/2026)

Details in [`SPEC.md` §18](SPEC.md); approved mock [`design/batch2.html`](design/batch2.html), rest timer **option B** (inside the card).

| Decision | Why |
|---|---|
| **Rest timer inside the card (option B):** committing a set's reps (Enter, or leaving the box) starts a timer right under that set; it counts up against the rest range ("Rest 0:48 · aim 1–3 min"), turns "Ready — go when you are" at the minimum and "Over 3 min — get going" after the maximum. +30 s pushes both; Skip removes it. One timer at a time: the next set restarts it, another card moves it. Typing alone starts nothing. The ranges are numbers in `program.js` (`REST_SECONDS`); the "3–5 min" / "1–3 min" text is derived from them | The owner chose the timer on the card over a bar pinned at the top: nothing covers the exercises. One source for the ranges keeps the guidance and the timer in step. |
| The timer lives in the draft (`draft.rest`), so it survives tab switches, reloads and iOS closing the app; Save, Skip and discarding the draft clear it | iOS kills home-screen apps in the background; the elapsed time comes from the start time, not from a running counter. |
| **One short beep when the rest is up**, on any tab, only if it became ready in the last few seconds (reopening the app later stays quiet), and the card flashes once. Data → Settings has "Rest timer sound" (on unless switched off) with the note that iPhone web apps can't alert in the background | Web apps can't notify while closed or locked; saying so once avoids a false promise. |
| The timer slides in only after the tap that left the reps box has finished | Leaving the box by tapping "+ Set" or the next box must work on the first tap (§17.5); moving the page mid-tap made that tap miss. |
| **Warm-up checklist** on the main lift: one checkbox per warm-up set ("20 × 10, empty bar"), "2 of 4 done". Ticks live in the draft only and reset when the work weight changes | Ticking off the ramp at the gym; it is not part of the logged workout. |
| **Workout times:** the start is the time of the first reps typed, the finish the time of Save; editing keeps them. Times are local wall-clock "YYYY-MM-DDTHH:MM" strings, like dates. The CSV gains `started_at` / `finished_at`; the text backup a `Time: 18:42–19:34` line (a full date is written only when a clock time alone would be read wrongly, e.g. a start on the day before the workout's date). Older backups and v6 data have no times and show "Time not recorded" | When a workout happened and how long it took stay with it; backups must not lose them, and nothing logged before the update is lost or guessed. |
| A workout typed in for another day ("Change date", e.g. yesterday's, logged this morning) gets no clock times; it shows "Time not recorded" | The clock would say when it was typed, not when it was done. A late workout that ends after midnight keeps both times. |
| Today's header says "Last workout: Wed 18/11 at 19:41" — the time it was saved — before a workout starts, and "Started 18:42 · 23 min so far" once it has | The owner asked for "the time which last workout was added". |
| **"Done for today ✓" until midnight** after a workout is saved with today's date: the day's workouts (times, exercises, bests, Edit) and "Up next — shows here from 12 am" with "Start it now instead" for a double day. The cycle logic is unchanged | Right after a save Today used to jump to the next workout; now the day's work and its bests stay in view until the next day starts. |
| Saving the second workout of a double day brings "Done for today ✓" back (with both workouts) | "Start it now instead" is for that workout; once it is saved the day is done. The spec leaves this case open. |
| **New bests:** a track's heaviest weight (plank: longest hold) beating every earlier session; a first-ever exercise or an equal weight never counts. After Save a "Workout saved" sheet celebrates them (🎉 "New best!") or says "Workout saved ✓", with time, exercises and weight lifted. 🏆 pills and "best" tags mark them on the Done card and in History, computed on the fly | Linear progression makes progress visible every week; nothing extra is stored, so edits and imports stay consistent. |
| History cards show the 🏆 pill with its count ("🏆 1 new best"), as the spec says; the mock showed the cup alone | One pill, the same on Today and in History. |

### Batch 2 — changes after the independent review (20/11/2026)

| Decision | Why |
|---|---|
| **A workout is one sitting of at most 4 hours** (`MAX_WORKOUT_MINUTES` in `program.js`). A start time older than that is from an earlier sitting: Today shows "Started 18:42" without "so far", and Save keeps the start but records no finish (History: "Started 18:42"). A late workout that ends after midnight (23:30 – 00:20) is unaffected | A draft started in the evening and saved the next morning showed "12 h 18 min so far" and was stored as a 12-hour workout. The save time says when the draft was saved, not when the workout ended. |
| **The clock starts with the next reps typed today** when a new workout has no start time, or one from an earlier sitting: a draft typed before this update (v6 drafts have reps but no time), a date changed away and back, or a draft picked up again hours later. Changing a new workout's date drops its start time | Before, only the very first reps of a workout could start the clock, so these workouts were saved with "Finished 19:34" alone. |
| **Editing a saved workout from History starts no rest timer** (so no beep); new workouts, including ones logged for another date, still do | Correcting yesterday's reps is not a rest between sets. |
| **"− Set" on the set the rest timer sits under removes the timer** | The timer disappeared from the screen but stayed in the draft and still beeped. |
| **A new barbell weight resets the warm-up ticks** (Data → Settings) | The warm-up list starts with the empty bar, so a new bar is a new list (§18.2); the old ticks landed on different sets. |
| **Plank holds are not weight lifted:** the "lifted" tile and the weekly volume chart leave timed exercises out | Their reps are seconds: a weighted plank (2.5 kg × 60 s × 3) added 450 kg "lifted". |
| The toast stays on one line at iPhone width ("Saved Push B · 20/11/2026"), also above the "Workout saved" sheet | It could only be half the screen wide, so longer messages wrapped into a tall two-line pill. |

## Batch 3 — owner approved (24/11/2026)

Details in [`SPEC.md` §19](SPEC.md); approved mock [`design/rest-and-set-timer.html`](design/rest-and-set-timer.html). The owner: "the rest time should be recorded too, and a next-exercise start button — the rest must not include the next exercise's time"; "both" (time each set too); "for supersets consider the rest time as one".

| Decision | Why |
|---|---|
| **Rest and set times are recorded on the sets** as whole seconds: `rest` (0–3600) is the rest right before a set, `duration` (1–3600) the set timer from Start to committing the reps. Backups keep them: the CSV gains `rest_s`, `set_s`; the text backup an indented line under the exercise, `rest - 2:41 3:05 · sets 0:38 0:40 0:52` ("-" = not recorded). Older backups and v7 data still load; Batch 2's running `draft.rest` becomes `draft.timer`. `dates.parseClock` now reads "2:41"; the wall-clock reader of the `Time:` line is `parseWallClock` | The owner wants the real rests kept with the workout. A rest stops when Start is tapped, so it never includes the next exercise's set. Nothing logged before is lost or guessed. |
| **Start buttons drive the timers** (new workouts only; an edit runs none). Committing a set starts the rest box under it with **Start set N+1**, **Start round N+1 · <a>** or **Start next exercise**, plus +30 s and Skip; tapping Start saves the rest on the next set and starts its **Set timer** ("Set 2 · 0:24 · rest before it 2:41", Cancel). With no timer running, the next set to do shows a small **Start set N**. Committing without tapping Start records nothing for that set, as before. A timer older than 4 hours is dropped; a rest it already recorded stays | One tap at the start of each set is all the owner adds; everything else is measured. The 4-hour rule is the same one-sitting rule as the workout times. |
| **A superset is one unit**: after a's set N, b's set N starts by itself (no rest, its card opens and comes into view); after b's set N there is one rest for the pair, recorded on a's set N+1. b's sets never carry a rest. Pairs come from the plan (`program.supersetPairs`): pushdown ↔ lateral raise, overhead extension ↔ the second lateral raise, rear delt fly ↔ band pull-apart | "Consider the rest time as one": the pair is done back to back, so the only rest is between rounds. |
| **Shown where the workout is**: under each committed set a muted "rest 2:41 · set 0:38"; in History a line under each exercise ("rest –, 2:41, 3:05 · sets 0:38, 0:40, 0:52"; superset a "rounds with Lateral raise · …", b its set times only); "· avg rest 2:20" on the History and Done summary lines and an "avg rest" tile on Workout saved | The numbers are visible at the gym and afterwards, without a new screen. |
| **Storage meter** on Data: "Storage used: 0.4 MB of about 5 MB" (the saved state's characters), and above 80% an amber "Storage nearly full — export a backup, then delete old workouts." with its icon | iPhone web storage is about 5 MB and recorded times make each workout bigger; the warning comes while there is still room to export. |
| `sw.js` cache `ppl-v8`, PRECACHE = the real files | Installed phones pick up the new version. |

### Batch 3 — calls made while building (24/11/2026)

| Decision | Why |
|---|---|
| "The next set to do" and the Start targets follow the order the sets are done: card by card, a superset round by round (a1, b1, a2 …). "Start next exercise" goes to the next card with an empty set, then back to any set left earlier; when nothing is left there is no Start button | §19.2 says "the first empty set of the first unfinished card"; done literally, a cancelled superset set would point back at a instead of b. Sets skipped earlier are still offered at the end. |
| Only a **new** set (its box was empty before typing) starts or moves a timer. Correcting a set that already had reps, or committing the same value again, leaves the timers alone | Fixing set 1's reps while resting after set 3 must not throw away that rest or offer "Start set 2" for a set already done. |
| A rest or set time over 60 minutes (the 0–3600 range) is not recorded; the timer still runs | Such a value is not a rest between sets, and it could not be stored or backed up. |
| The superset's first card says "set 0:31 · then straight to Lateral raise" and a "⇣ superset — no rest in between" line joins the two cards; the round rest says "one rest for the pair" | As in the approved mock (screen 3). |
| History finds a workout's superset pairs from that day's current plan (exercise and occurrence, §17.1) | Workouts store no slots. A pair swapped away since only loses the "rounds with" words; the times are still shown. |
| "Workout saved" shows its four tiles 2 × 2 when the average rest is one of them | Four tiles in one row wrapped "2,063 kg" and the clock range at iPhone width. |

### Batch 3 — changes after the independent review (24/11/2026)

| Decision | Why |
|---|---|
| **The workout starts at the first Start tap or the first reps typed, whichever comes first** (this replaces §18.3's "when the first reps value is entered"); the 4-hour sitting rule is unchanged. A new-workout draft with no reps yet but a set started in this sitting (Start at 23:59, reps after midnight) keeps its date; one from an earlier sitting still moves to today, and its old start time goes with it | "Start set 1" at 09:00 and reps at 09:02 gave "Started 09:02", so the first set's 2 minutes fell outside the workout; a set started just before midnight even lost both times. |
| **A superset's second exercise never gets a rest, whichever Start leads to it**: "Start next exercise" landing on b's set (its a set done earlier), b's extra set after the last round ("Start set 4" on Lateral raise), and a Batch 2 rest timer left running under a pushdown set at the update. Start then starts b's set timer and saves no rest (`timers.nextAfter` → `recordsRest: false`) | §19.1: "b's sets never carry rest". Those rests were shown on Today and counted in the average, but History leaves b's rests out, so the numbers disagreed. |
| **After Skip or Cancel, "Start set N" carries on from where the timer was**, in the same order as the rest box's Start (`timers.nextToDo(…, from)`): the next set of the exercise being done, then the following cards, then sets left earlier. With no timer since the screen was opened (a fresh workout, a reload) it counts from the top, as before | A Squat set left out sent the button back up to the Squat card after a Skip on Romanian deadlift, contradicting the call above ("sets skipped earlier are still offered at the end") and leaving no Start under the set being done. |
| **Storage full: Save no longer says "Saved"**. When the phone refuses the write there is no "Saved …" toast and no "Workout saved" sheet; "Couldn't save on this phone (storage full?) — export a backup now" stays on screen (any failed save now shows after the tap's own message, so "Imported …" or "Swapped …" can't hide it either). The workout stays in the open app, so Export still has it | The warning was replaced by "Saved Legs · …" in the same instant, and the sheet celebrated a workout that a reload would lose. Recorded times make workouts bigger, so a full phone is more likely than before. |
| The timer rules and "what comes next" (`usableTimer`, `restTaken`, `setTaken`, `pairWith`, `setOrder`, `nextToDo`, `nextAfter`) moved from `ui/rest.js` to the pure `timers.js`, with unit tests (`tests/timers.test.js`); `rest.js` keeps the markup and the beep. `sw.js` precaches `./js/timers.js`, and `tests/sw.test.js` checks PRECACHE against the real files | They are rules and had no unit tests. The move changed no behaviour (the timer e2e scenarios passed before the fixes above). |

## Process

The rules were written first and agreed before any code. Each change went through three separate steps:
1. tests written first, from the spec;
2. code written by someone else, who couldn't edit the tests;
3. an independent review that fixed bugs and added a test for each one.

The screens were built only after the owner approved the design mocks.

## Owner change 24/11/2026

| Decision | Why |
|---|---|
| **The workout clock starts at the first warm-up tick** (else the first Start tap, else the first reps typed — whichever comes first) | The owner counts the warm-up as part of the workout. Unticking or ticking again never moves the start; the 4-hour rule still applies. |

## Owner change 27/11/2026 — Start workout + keep the screen on (SPEC §20)

| Decision | Why |
|---|---|
| **A "Start workout" button** sits under Today's heading (and its "Last workout" line) on a new workout for today — also in "Start it now instead" — until the workout has started (no start in this sitting, the 4-hour rule). Tapping it sets the start to now and saves the draft straight away, so a reload keeps it with no reps; the button then gives way to "Started 18:40 · 0 min so far". It uses the same start rule as the warm-up tick, Start tap and reps (`canStart` + `startClock` in `ui/today.js`), so editing a saved workout or a workout for another date shows no button | The owner wants to start the clock on purpose, before the warm-up. One rule for every way of starting means the button can never disagree with the backup. |
| **Backup = option A**: without the button the workout still starts at the first warm-up tick, Start tap or reps typed, whichever comes first; once started nothing moves the start — switching to another workout with "Doing a different workout?" keeps a start from this sitting too | The owner picked option A: a forgotten tap costs nothing, and the times are never moved later than the first thing done. |
| **The screen stays on while a rest or set timer runs** (`timers.needsWakeLock(timer, settings)`, pure): one screen wake lock (`ui/awake.js`), held while a timer runs, the page is visible and "Keep screen on during timers" is on; released on Skip, Cancel, Save, when the timer goes (4 hours) or the switch goes off. iPhone drops the lock when the app is hidden, so it is asked for again when the app shows. Errors are ignored. `app.js` checks it after every save and every redraw, so no path that changes the timer or the setting is missed; when nothing changed the lock is left alone. Start workout alone does not keep the screen on | Between sets the phone sits on the bench and auto-lock hid the timer. Only while a timer runs, so the battery cost stays small. |
| **"Keep screen on during timers"** in Data → Settings, under "Rest timer sound": a switch, on by default (`settings.keepAwake`, missing = on), with "Uses a little more battery while a timer runs." and, when the browser has no Wake Lock API, "This browser can't keep the screen on." | The owner can turn it off; the note says why it might do nothing. |
| `sw.js` cache `ppl-v9`, PRECACHE = the real files (adds `./js/ui/awake.js`) | Installed phones pick up the new version. |
| *Review 27/11:* **after midnight with Today open, a draft that hasn't started moves to the new day at once** (the same rule a redraw already applied, `movesToToday` in `ui/today.js`): before, only an untouched form did, so a draft with just a note or a swap kept the old date until the next redraw, the Start workout button vanished at midnight and reps typed then started no clock | The button and the start rule must follow the day the workout is done on. |
