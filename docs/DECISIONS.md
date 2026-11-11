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

## Process

The rules were written first and agreed before any code. Each change went through three separate steps:
1. tests written first, from the spec;
2. code written by someone else, who couldn't edit the tests;
3. an independent review that fixed bugs and added a test for each one.

The screens were built only after the owner approved the design mocks.
