# Tomorrow Sheet — deploy (3 files)

Repo: github.com/rkornis-p/trading (main). All three go in the repo ROOT, same folder as desk.html.

1. **tomorrow.html** — NEW. Add file → upload.
2. **desk.html** — REPLACE. Adds section "I½ · Last Night's Sheet" between the London read and the trade, a lean-agreement note on the score line, and a TOMORROW nav link. Nothing in scoring, Sentinel, or the 8:35 logic was touched.
3. **hub.html** — REPLACE. Adds "0 · The Night Before" above Morning Call, and the nav link.

Commit all three, wait ~1 min for Pages, then open rkornis-p.github.io/trading/tomorrow.html.

## The routine
- **Tonight (any time after 3:00):** open tomorrow.html → BUILD THE SHEET (~60–90 s; it walks the board slowly to respect the relay's rate limit). Read it. PRINT.
- **Auto:** leave the tab open on the MacBook and it builds itself at 3:10 CT and repriced itself at 7:45 CT. iPhone Safari suspends background tabs — on the phone, tap the buttons.
- **7:45:** LONDON REFRESH (auto if the tab is open). Names that have gapped through a trigger get an amber flag — that trigger is dead, the 8:35 range replaces it.
- **8:15:** open the Desk. The sheet appears as I½. The score line on the trade tells you whether last night's lean agrees with the live score.

## One thing to know
The sheet is saved in the browser's localStorage — the same place the board and pass line live. Build it on the device you'll read the Desk from in the morning (or print it). If you build on the Mac and open the Desk on the phone, the phone won't have it until you tap BUILD there too.

## What "lean" means
Daily-chart structure only: 20-day and 50-day averages, 9-day EMA, where it closed inside its range, 5-day slope, daily RSI, today's volume vs normal, prior-day break, and the futures tone. BULL/BEAR needs a 12-point gap between the two sides; otherwise NEUTRAL. It is the argument. The Desk's 5-minute score at 8:35 is the verdict.

Triggers: today's high (calls) / today's low (puts). Stop: 0.35 daily-ATR beyond the trigger. T1: the 5-day high/low if it's at least 0.4 ATR away, otherwise 1 ATR. Contracts: ~0.70Δ, 5–10 DTE, both sides, from one chain call per name — strike and expiry are the plan; the mid will move by morning.
