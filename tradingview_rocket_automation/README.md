# TradingView to Rocket Scanner automation

This Rocket Scanner helper automates the TradingView download through a real
browser session (visible only during manual setup; normal runs are hidden):

1. Open the configured TradingView Stock Screener.
2. Use its visible export menu to download the current CSV.
3. Save the completed download atomically as `ALL NSE.csv` in `Scanner Uploads`.
4. Notify the already-open Rocket Scanner page that a new download is ready.
5. Let that visible page run its normal saved-folder `processFiles()` path.

It does not call an unofficial scanner API, inspect or validate CSV rows,
bypass login/CAPTCHA/consent, or use the Windows Save As dialogue. The utility
uses installed Google Chrome and a dedicated `browser_profile` that retains the
TradingView login. The visible Rocket Scanner page retains its own Drive and
`Scanner Uploads` permissions and performs the actual file ingestion.

## Install

Install supported 64-bit Python 3.11 or newer from
<https://www.python.org/downloads/windows/>. During installation, enable
**Add Python to PATH**. Open Command Prompt and run:

```bat
cd /d "C:\Users\nitin\Desktop\Apps\Trading\Rocket Scanner\tradingview_rocket_automation"
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

Playwright is still required for automation, but manual setup and Google sign-in
use a normal installed Chrome process. Playwright connects to that process over
local CDP after Chrome starts, so Google sees the ordinary Chrome sign-in flow.
Do not add browser-evasion flags or attempt to bypass Google security checks.

Edit `automation_config.json` before running. Set `tradingview_url` to the
actual saved Stock Screener URL, and confirm `rocket_scanner_url` and
`scanner_uploads_folder`. All URLs, timings, intervals, timeouts, and filenames
are configuration values; no Python edit is needed for normal changes.

## First setup

Run:

```bat
python tradingview_rocket_automation.py --setup
```

The headed dedicated browser opens both pages and stays open. Manually log into
TradingView, complete any two-factor/CAPTCHA/consent prompt, connect Google Drive
in Rocket Scanner, and click **Load Files** once. If the folder picker appears,
select the existing `Scanner Uploads` folder. Press Enter in the terminal only
after those steps are complete. The browser state is then retained in
`browser_profile/`.

## Inspect selectors

Use this before a first run or after TradingView changes its menu:

```bat
python tradingview_rocket_automation.py --inspect
```

The terminal prints the candidate TradingView menu/export labels without
downloading or refreshing Rocket Scanner. The alternatives are centralized near
the top of `tradingview_rocket_automation.py` in
`TV_MENU_CANDIDATES` and `TV_EXPORT_CANDIDATES`.

The current candidates include the accessible **ALL NSE** button and visible
export labels such as **Download results as CSV**, **Download CSV**, and
**Export screen results**.

## One test cycle

Run exactly one complete export-and-notification cycle. This ignores the normal
operating window and random interval:

```bat
python tradingview_rocket_automation.py --once
```

Normal recurring runs use headless Chrome and do not open a visible Chrome
window or console. Rocket Scanner's **Start Automation** button starts the
staggered day schedule and displays live progress in the header. Use **Pause**,
**Resume**, or **Stop** beside it to control the schedule. The first time, run
`register_automation_button.bat` once to enable that button.

The previous `ALL NSE.csv` is left untouched if the browser download fails. A
successful download is first saved as `ALL NSE.new.csv`, then atomically
replaces `ALL NSE.csv`. No other file in `Scanner Uploads` is modified, and stale
temporary files created by this utility are removed at startup.

## Recurring mode

Start normal operation with:

```bat
python tradingview_rocket_automation.py
```

The utility uses `Asia/Kolkata`, waits for weekdays and the configured start
time, and runs one cycle at a time. After every completed, failed, or paused
cycle it chooses a fresh random whole-minute interval between the configured
minimum and maximum, measured from the end of that cycle. It does not precompute
the day's schedule. The optional final cycle is scheduled independently and is
skipped when a random cycle finished within `final_cycle_proximity_minutes`.

Create `automation_pause.txt` in this project folder to pause at the next cycle
boundary while composing baskets. The utility logs `paused`, keeps the normal
schedule, and resumes automatically after the file is removed.

Press Ctrl+C to stop gracefully. `automation.lock` prevents a second instance;
an abandoned lock is removed when its recorded process is no longer alive.

## Windows Task Scheduler

The recommended setup is one weekday task that starts shortly before
`automation_start` and launches `start_market_automation.bat`.

Suggested settings:

- Run only when the user is logged on, so the headed browser can be seen.
- Do not start a new instance if the task is already running.
- Allow the computer to wake if that is appropriate for the trading machine.
- Stop the task after a sensible maximum duration, such as 10 hours.
- Configure restart-on-failure only if it is acceptable to reopen the dedicated browser.

The utility, not Task Scheduler, manages the random cycles. Do not create a
separate scheduled task for every interval.

## Login and permission recovery

If TradingView requires login, two-factor, CAPTCHA, consent, or session renewal,
stop recurring mode and run `--setup` to complete it in the headed dedicated
browser. No security challenge is bypassed.

If the visible Rocket Scanner page loses Drive or `Scanner Uploads` permission,
reconnect Drive or press **Load Files** once and select `Scanner Uploads`. The
next completed download can then use the saved permission again.

## Logs and evidence

`logs/automation.log` is a rotating timestamped log. Each cycle has an ID and
records the named stages: TradingView page opened, Screener ready, Menu opened,
Export clicked, Download started, Download completed, `ALL NSE.csv` replaced,
and visible-page refresh requested. Retries, selected intervals, next execution
times, failure stages, and exception details are recorded.

Browser failures save a timestamped screenshot in `failure_screenshots/` and,
for selector-related failures, page HTML in `failure_pages/`. Logs and evidence
never contain passwords, cookies, access tokens, or browser-profile contents.

## Updating selectors

If TradingView changes its menu labels, run `--inspect`, then adjust the two
candidate tuples near the top of the Python file. Keep accessible roles and
visible labels before resorting to CSS. Do not use absolute XPath or screen
coordinates. Rocket Scanner selectors are based on its existing IDs and should
only be changed if the app itself changes.

## Stopping and recovering

Use Rocket Scanner's **Stop** button, or press Ctrl+C when recurring mode was
started from a terminal. Do not delete `browser_profile/`; it is the persistent
session. If a browser crash leaves an old lock, restart the utility; it removes
a lock whose recorded process is no longer alive. If a cycle fails, the next
recurring cycle still gets a newly randomized interval and the previous valid
`ALL NSE.csv` remains in place.

The folders `browser_profile/`, `logs/`, `failure_screenshots/`, and
`failure_pages/` are intentionally ignored by Git and should never be copied
into source control.
