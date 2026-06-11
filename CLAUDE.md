# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

### Core Concept

Every trading day, regardless of what the broader market is doing, a small subset of NSE stocks moves sharply intraday. These are **Rockets**. The observation is that rockets don't happen randomly: the stocks that become rockets tend to share measurable characteristics *the day before* they move. The mix of characteristics that matters shifts with market conditions and time.

The system's job is to identify rockets *before* they move, not explain them after. It does this by continuously learning -- after each trading session, it correlates yesterday's feature values against today's actual rockets, and uses that to weight tomorrow's recommendations. Stocks that looked like yesterday's rockets, but haven't moved yet, are the candidates.

A secondary constraint is chase control: **Max 1D %** is the user-set ceiling (default 5%) that can exclude stocks which have already moved too far. **Max Entry** remains an auto-calculated runway reference, but the entry-ceiling gate has been intentionally removed; it must not reject candidates or basket exports unless explicitly reintroduced. `Rocket %` is only the rocket-label/learning threshold. The default early-entry display preset also uses Price Max `â‚¹1,200`, Vol multiplier `500`, Min TV `â‚¹1 crore`, and Min MCap `â‚¹50 crore`; saved personal filter choices still override defaults.

The system is fully personal: it learns from this user's own trade history (adaptive SL/TGT from their actual tradebook), current holdings (suppression and top-up logic), and exit behavior (missed-opportunity nudge added to TGT).

Adaptive performance must not blindly mix pre-system/manual trading history with scanner-era behaviour. `SYSTEM_TRADE_START_DATE` is the fixed scanner-era floor for adaptive trade outcome calculations; the effective start is the later of that date and the first sell date available in the rolling 365-day tradebook export. The full tradebook remains stored for backup/open-lot reconstruction, but Performance KPIs, learned sizing, and exit-policy feedback default to trades closed on/after the effective start. Once the rolling tradebook naturally starts after `SYSTEM_TRADE_START_DATE`, the cutoff rolls seamlessly with it.

### Implementation

Standalone single-file HTML/JS web app for scanning, ranking, and managing NSE stock trades. Runs entirely client-side with no build step or application server (CDN scripts: JSZip for ZIP parsing and Google Identity Services for Drive authorization).

### Deferred Extension

Crypto mode has been intentionally removed from the active app. It may be added later as a separate module only after it has its own execution-history input and outcome-feedback loop. Do not mix future Crypto state or learning with NSE stock state.

## Deployment

- **Local**: Open `index.html` directly in a browser.
- **Online**: GitHub Pages at `https://axionaut.github.io/rocket-scanner/`
- **Repo**: `https://github.com/axionaut/rocket-scanner` (public)
- **Push workflow -- mandatory release gate for every tracked app change:**
  1. Update `CLAUDE.md` for architecture/behavior changes first. It is ignored/local-only and must never be staged or committed. A documentation-only edit to `CLAUDE.md` does not trigger a push.
  2. Inspect `git status --short --ignored --branch` before release work. `rocket_brain.json` is live runtime state tracked as a git backup snapshot. Preserve changes already present, do not rewrite/reset it while diagnosing, and ensure no stale open browser tab is still writing old engine state before relying on its contents.
  3. Increment the shared `APP_VERSION` integer in `index.html` for each deployed code change, then stamp `BUILD_TS` using the PowerShell block below. `APP_VERSION` is a release constant, never a browser-local counter, so all devices display the same header version. The timestamp command uses `WriteAllText` instead of `Set-Content`, because `Set-Content` can add EOF formatting churn.
  4. Run `git diff --check` immediately after stamping; fix formatting issues before testing.
  5. Run the single confirmed headless Chrome smoke block below. Use a fresh `.chrome-smoke-*` profile, `Start-Process -WindowStyle Hidden -Wait`, redirected stdout/stderr, and require non-empty DOM plus expected markers. Do **not** use visible Chrome, and do **not** count a zero-output run as a pass. If Chrome or Git fails due to sandbox/permission restrictions, request escalation for the same required operation rather than trying alternate smoke methods.
  6. Clean `.chrome-smoke-*` profiles with the cleanup block below even after a failed smoke test.
  7. Remove temporary files/directories created during the current work before staging. This includes smoke-test profiles, transient logs, scratch files, and generated validation artifacts. Do not delete user/runtime artifacts or pre-existing ignored files such as scanner uploads, basket exports, workspace files, or `rocket_brain.json` backups unless the user explicitly asks.
  8. For every `index.html` deployment, stage `index.html` and `rocket_brain.json` together, then run `git diff --cached --check` and `git diff --cached --name-only`. The pairing is mandatory because each code push also captures the latest available live brain backup in git, not because code execution depends on a brain change. If `rocket_brain.json` has no textual diff, `git add rocket_brain.json` is still required but Git will naturally commit only files whose content changed. Never overwrite, manufacture, or silently discard a live brain diff.
  9. Commit, push `master`, then run `git status --short --branch` and `git log -1 --oneline`. Report the pushed commit hash, smoke-test result, and whether the tracked tree is clean.
  10. GitHub Actions auto-deploys in ~2 minutes after push.

**Timestamp command (PowerShell):**

```powershell
$now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'India Standard Time')
$ts = $now.ToString('yyyy-MM-dd') + ' ' + $now.ToString('HH') + ':' + $now.ToString('mm') + ' IST'
$path = (Resolve-Path 'index.html').Path
$text = [System.IO.File]::ReadAllText($path)
$text = $text -replace "'\d{4}-\d{2}-\d{2} \d{2}:\d{2} IST'", "'$ts'"
[System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
Select-String -Path index.html -Pattern "const BUILD_TS"
```

**Required headless smoke command (PowerShell):**

```powershell
$ErrorActionPreference = 'Stop'
$profile = Join-Path (Resolve-Path '.').Path '.chrome-smoke-final'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$url = (New-Object System.Uri((Resolve-Path 'index.html').Path)).AbsoluteUri
$stdout = Join-Path $profile 'dom.txt'
$stderr = Join-Path $profile 'stderr.txt'
$args = @('--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--disable-background-networking',('--user-data-dir="' + $profile + '"'),'--window-size=1440,1000','--virtual-time-budget=2000','--dump-dom',('"' + $url + '"'))
$p = Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList $args -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$dom = [string](Get-Content $stdout -Raw -ErrorAction Stop)
$err = [string](Get-Content $stderr -Raw -ErrorAction Stop)
if($p.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($dom) -or $err -match 'Uncaught|SyntaxError|ReferenceError|TypeError'){ throw 'Headless smoke failed' }
@('NSE Rocket Scanner','Regime-Adaptive mRMR','const BUILD_TS').ForEach({ if($dom -notmatch [regex]::Escape($_)){ throw "Missing DOM marker: $_" } })
```

**Smoke cleanup command (PowerShell):**

```powershell
$root = (Resolve-Path '.').Path
Get-ChildItem -Force -Directory -Filter '.chrome-smoke*' | ForEach-Object {
  $p = $_.FullName
  if($p.StartsWith($root)){ Remove-Item -LiteralPath $p -Recurse -Force }
}
```

`rocket_brain.json` is tracked in git as a backup of live runtime state. It must be included in the staging command for every `index.html` push so a current brain backup is captured whenever available; it may also be pushed separately after the system has learned new state. Before any restore or overwrite, create a timestamped backup such as `rocket_brain.damaged_YYYYMMDD_HHMMSS.json`.

`index.html` is the main and only source file (~4400+ lines, all CSS/HTML/JS inline).

---

## Cloud Input Files (Google Drive `appDataFolder`)

| File | Purpose |
|---|---|
| `ALL NSE.csv` | Full NSE universe -- TradingView screener export (primary input) |
| `Holdings.csv` | Zerodha holdings export -- current portfolio with avg cost and LTP |
| `Positions.csv` | Zerodha positions export -- T+1 unsettled buys not yet in Holdings |
| `TRADEBOOK.csv` | Zerodha full trade history -- FIFO P&L, charge calculation, performance stats |
| `Orders.csv` | Zerodha same-day orders -- live intraday P&L panel |
| `NSE Holidays.csv` | NSE trading holiday list -- `Sr. No,Date,Day,Description` format, Date as `DD-MMM-YYYY`. Used by `tradingDaysBetween()` to validate PREV_SNAP staleness. Persisted in brain; only needs re-upload when holiday list changes. |
| `Reports-Daily-Multiple.zip` | NSE daily ZIP -- bhav copy, security/price-band list (`sec_list`), 52W high/low, surveillance (REG1), bulk/block deals |

`rocket_brain.json` -- brain file auto-saved online in the user's private Google Drive `appDataFolder` after Drive is connected. The same brain is mirrored locally on every save, but local means per-device: desktop Chrome/Edge with File System Access writes a real local `rocket_brain.json` in the selected workspace folder (or in `Scanner Uploads` if that exact folder was selected), while browsers without writable folder handles, including phones/tablets and many mobile browsers, use IndexedDB as the device-local mirror and startup fallback. Persisted desktop folder handles are restored only when the browser still reports read/write permission; otherwise the next `Load Files` click refreshes the handle. Also manually exportable/importable via Export Brain / Import Brain buttons. **Tracked by git** (`.gitignore`: `!rocket_brain.json`) so current learned/runtime state is backed up. Always include it in the `git add` command when pushing `index.html`; if its content is unchanged, Git will not create an artificial file change.

---

## Architecture

Single-file app. All CSS, HTML, JS inlined in `index.html`. No build step -- edit and reload.

### Data Flow

0. **Active universe**: NSE equities only. There is no active market-mode switch.

1. **File ingestion**: `processFiles()` routes stock scanner and Zerodha/NSE enrichment files. `ALL NSE.csv` updates the stock scanner. NSE ZIP/portfolio/tradebook files enrich its feedback loop. `detectNSE()` routes NSE CSV files into enrichment maps:
   - `normSym()` is the single stock symbol normalizer. It strips exchange prefixes, uppercases, and converts TradingView underscores to NSE/Zerodha hyphens (`HCL_INSYS` -> `HCL-INSYS`). Use it for scanner, NSE, Zerodha, saved brain, and basket symbols.
   - `parseBhavdata()` â†’ `NSE_BHAV` map (`{delivPct, nseVol}` per symbol, EQ series only)
   - `parsePriceBand()` â†’ `NSE_PRICE_BAND` map from `sec_list` (`{bandPct, remarks}` per EQ symbol). Used by the shared `getPriceBandBlockReason()` hard check to block stocks already at/near their actual NSE price band; buffer is `PRICE_BAND_BLOCK_BUFFER_PCT = 0.15`, so a 5% band stock at 4.9% is treated as effectively locked/no-seller. Fallback remains the legacy 19.5% ceiling when band data is unavailable.
   - `enrichRowsWithNSEData()` reapplies current NSE enrichment, especially `price_band_pct`, to restored/saved scanner rows after cloud ZIP hydration. This is required because saved `rs_data` rows may predate a newly uploaded `sec_list`; display filters must still be able to block near-band stocks without forcing a fresh ALL NSE engine run.
   - `parseNSEHolidays()` â†’ `NSE_HOLIDAYS` Set of `YYYY-MM-DD` strings; persisted to brain as `rs_nse_holidays`; loaded on startup and from cloud `NSE Holidays.csv`
   - `parse52W()` â†’ `NSE_52W` map (`{high52w, low52w}` per symbol, EQ series only)
   - `parseSurv()` â†’ `NSE_SURV` map (symbol â†’ array of rule keys for flagged stocks); also populates `SURV_RULE_HITS` (per-rule count), `SURV_FILE_RULES`, `SURV_HEADERS`, `SURV_ALL_HITS`
   - `parseDeal()` â†’ `NSE_BULK` / `NSE_BLOCK` maps (BUY deals only)
   - `parseCSV()` â†’ generic quoted-CSV parser used everywhere
   - `parseHoldings()` â†’ `HOLDINGS` (active, qty>0), `HOLDINGS_ALL` (all rows), `HOLD_COST_MAP`
   - `parsePositions()` â†’ `POSITIONS` `{symbol, qty, avg, ltp, pnl, isSell}`
   - `parseTradebook()` â†’ `TRADEBOOK_STATS` (FIFO round trips, KPIs, profit-velocity exit policy, `lastDayRows`, and `openPositionLotsMap` containing unmatched FIFO buy quantities/dates)
   - `parseOrders()` â†’ `ORDERS_TODAY` (COMPLETE orders only, array with `_loadedThisSession=true` flag)

2. **Engine** â†’ `runEngine(raw, sessionTag)` -- core mRMR scoring pipeline:
   - **Column detection**: auto-detects all columns dynamically. `safeKey(h)` normalises headers to lowercase alphanumeric+underscore. `findKey(regex)` finds the safeKey that matches a pattern. `K` object holds safeKeys for known special columns (price, price_change, atr_pct, perf_1w, volume, turnover, piotroski, high_1d, low_1d, vwap, change_from_open, relative_volume_at_time, relative_volume_1_day, DMI positive, DMI negative).
   - **Numeric detection**: samples first 50 rows; column is numeric if â‰¥30% of non-blank values parse as finite numbers. `num()` trims values and treats empty strings, whitespace, `-`, `--`, `NA`, and `N/A` as `null` before numeric parsing.
   - **Feature set**: ALL auto-detected numeric columns + NSE-derived columns (`delivery_pct`, `range_pos`, `pct_from_52w_high`, `peak_retention`, `price_band_pct`, `pct_to_upper_band`) + sector/industry features. No features are manually selected; mRMR decides what matters.
   - **Relative volume**: TradingView `Relative volume at time` and `Relative volume 1 day` are used as plain raw TV inputs. They are not direction-adjusted or overwritten before mRMR. High RVOL is only treated as buying interest when directional evidence is upward; when high RVOL appears without upward directional confirmation, the stock is treated as sell-pressure/distribution and removed by `REMOVED.supply`.
   - **Hard filters** -- single-pass design (`filtered`). Learning population = display population (no `learningSet` split). Stocks mode filters:
       - Yesterday's rockets (`ENGINE_DATA.yesterdayRockets`) â†’ held continuations are included in the positive learning label; the already-rocketed symbols themselves remain suppressed from `FILT` in `applyFilters()`. Count shown as `â® N yday rockets hidden` pill. Not a hard engine filter -- suppression happens at display layer.
       - UC/price-band lock â†’ `REMOVED.uc`: if `sec_list` band exists, remove when `Price change % 1 day >= bandPct - PRICE_BAND_BLOCK_BUFFER_PCT`; otherwise fallback to â‰¥19.5%. This same check also runs in display filtering and basket export, so restored/saved rows cannot bypass the band file.
        - Non-EQ series (BE/BZ/SZ/SM/ST) â†’ `REMOVED.nonEq`
        - Surveillance-flagged via user's `SURV_CUSTOM_RULES` â†’ `REMOVED.surv` (+ per-rule counts in `REMOVED.survRules`). Hard-removed from **both learning and display**.
       - Sell-side pressure stronger than buy-side â†’ `REMOVED.supply`. Uses direct buy/sell quantity columns when present. Otherwise, high raw RVOL (`Relative volume at time` / `Relative volume 1 day`) must have upward directional confirmation from current intraday DMI+/DMI-; if directional evidence is neutral/down, that RVOL is treated as selling pressure. Lower-RVOL names can still be removed when DMI- materially dominates DMI+ with weak VWAP/open/flow/retention confirmation. Blank direction signals pass through as unknown.
       - Shareholders <500 OR volume <`_liqMinVol` OR turnover <`_liqMinTurnover`, only when the source value is present â†’ `REMOVED.liq`
      - Piotroski exactly 0 â†’ `REMOVED.fscore`
      - ATR â‰¤0, only when present â†’ `REMOVED.atr`
      - Delivery <30%, only when present â†’ `REMOVED.deliv`
       - Peak retention <50% (when day range >1% of price) â†’ `REMOVED.fade`
    - Null/blank values are treated as unknown and pass through hard filters. Zero values can still be excluded where the filter explicitly treats zero as invalid.
    - Methodology snapshots include `hardFilterSchema` (`raw_rvol_directional_pressure_v1`). Saved removal counts from older schemas are not restored, because those older counts may use an older filter mix.
     - `REMOVED.rockets` -- `{uc:[],surv:[],nonEq:[],liq:[],fscore:[],atr:[],deliv:[],fade:[],supply:[]}` -- per-filter arrays of `{sym, pc}` for stocks that hit the Rocket% threshold but were blocked.
     - Snapshot saved from `filtered` (the single clean set).
   - `ROCKET_THRESHOLD` is **configurable** via the `fRocketPct` filter bar input (default 10%, range 5â€“20). Read each engine run; clamped to valid range. Stored in `ENGINE_DATA.rocketThreshold`. Used by the engine for labeling rockets in the learning step. Learning impact on next CSV upload. (Display ceiling is a separate explicit filter: `fMax1D`.)
   - **Market regime detection**: `marketBreadth = advancingStocks / totalParsed` on full universe before hard filters. Bull if breadth â‰¥55%, bear if <35%, else neutral. Sets `CURRENT_REGIME`. Regime is used for regime-specific correlation accumulators, with combined `ACC_CORR` as fallback.
   - **Universe movement card**: daily movement is `mean(abs(price_change))`, not intraday high excursion or a signed breadth proxy. `avgMoveUniverse` measures the hard-filtered engine/display population; `avgMoveAll` measures every parsed input row with valid daily change. The card shows both as `avg |move| U ... / All ...` so the useful scope can be evaluated without changing the calculation.
   - **Recommendation outcome feedback**: every Stocks scan persists the top displayed/eligible recommendation candidates that have not already crossed the rocket threshold in `rs_recommend_outcomes_v1`, including issue price, rank, score, and feature values. Later full-universe scans assess each pick for five trading sessions, with a stricter two-trading-day conversion checkpoint. The store records whether it became a rocket, how many days it took, best high upside, best/final close follow-through, worst low drawdown, and early-window high/close/low telemetry. The continuous `outcomeScore` runs from -1 to +1: rockets inside the two-day conversion window score strongest, delayed rockets score lower, partial early follow-through gets partial credit, and picks that fail to make meaningful early progress or move opposite become negative telemetry. Once at least 20 completed picks have varied outcomes, their feature/outcome correlations are blended into mRMR relevance with a maximum 50% weight. This is a global recommendation telemetry loop, not symbol memory.
   - **Executed-entry selection feedback**: `rs_entry_outcomes_v2` stores displayed recommendation cohorts after display filters and held/top-up qualification, then reconciles them with completed BUY executions from Orders/Tradebook. Fresh entries and top-ups are retained separately. Subsequent full-universe scans evaluate each actual entry for five trading sessions using estimated net attainable return after charges and net profit velocity (`net % / trading days`). Completed actual-entry outcome correlations are blended into mRMR relevance with capped confidence, so profitable fast entries reinforce similar candidates and failed recommended entries become negative selection evidence. This entry feedback is separate from tradebook-based exit-policy learning.
   - **Post-sale rocket feedback**: `rs_post_sale_rockets_v1` tracks realised FIFO sell lots that subsequently become rockets within five trading sessions, using full-universe scans so a stock remains observable even when it no longer passes today's recommendation filters. When there is repeated evidence (at least two escapes among at least ten assessed recent sold lots), the profit-velocity exit policy may extend the learned review horizon and apply a capped TGT nudge. It never widens SL from post-sale upside evidence; SL remains derived from realised loss behavior.
   - **Intraday trajectory supplement**: repeated same-day `ALL NSE.csv` uploads append compact feature-vector samples to `rs_intraday_ledger_v1` (latest 12 samples for the current session). The core previous-day/regime mRMR score remains the base. During scoring, current feature percentiles are compared against the previous same-day sample and the first same-day sample using the same learned feature directions and mRMR weights. The resulting trajectory signal can refine the final score with a capped 18% blend; first upload of a day has no effect beyond creating the baseline.
   - **mRMR scoring**: See dedicated section below.
      - **Session dedup**: `isNewSession = (!sessionTag || !ACC_CORR || ACC_CORR.lastTag !== sessionTag) && isMarketHours()` -- deduped by data hash, market-hours guarded.
   - **Regime-conditional accumulators**: Three separate accumulators -- `ACC_CORR_BULL`, `ACC_CORR_BEAR`, `ACC_CORR_NEUT` -- plus combined `ACC_CORR` as fallback. Running mean blend (not EMA). Each regime mean is updated only from that regime; `ACC_CORR` is maintained independently rather than copying the active regime. Sessions with no rockets remain session history but do not increment `learnSessions` or dilute correlation means. Legacy combined vectors are reconstructed from the saved regime means on their next engine update. Scoring uses regime-specific correlations when `learnSessions â‰¥ 2`, else combined fallback.
   - **Sector/Industry features**: computed across full universe before hard filters. `sector_breadth` = % advancing in sector (â‰¥3 stocks). `sector_rel_strength` = stock's change minus sector median. `industry_breadth` = same for industry column if present.

3. **Persistence** â†’ Brain state auto-saves to `rocket_brain.json` in the user's private Google Drive `appDataFolder` through the **Google Drive REST API** and Google Identity Services token popup (`FS` module). Filter state (`rs_filters`) stays in `localStorage`. The public OAuth Client ID is set once per browser until it is embedded in deployment configuration; access tokens live only in session storage and expire normally. `FS.set(key, val)` / `FS.get(key)` / `FS.setMultiple(obj)` remain the engine persistence contract. Export Brain / Import Brain buttons remain manual backup/restore tools.

   Drive access is optimized around one appDataFolder file-index cache per page load. `findFile()` should reuse that cache instead of issuing a Drive search for every read/write, but Drive connect/reconnect must invalidate and refresh that cache before reading the brain or canonical inputs so another device's latest uploads are visible immediately. Canonical input uploads are deduplicated by canonical name and uploaded in parallel; explicit `FS.write()` clears any pending debounced autosave before writing the brain so a final upload does not race with an older timer.

   `Load Files` is the only active data-ingestion action and it directly opens the directory picker (`fInDir` with `webkitdirectory`) for the user's `Scanner Uploads` folder. It must not show an intermediate upload screen, expose an individual-file picker, or enable file drop as an alternate ingestion route. Before opening the folder picker, and again before processing selected files, it must verify Drive is still connected/authorized; if the token expired, was revoked, or Drive is otherwise unreachable, it must show the reconnect prompt instead of starting the upload/load flow. Recognised inputs from the selected folder are first uploaded/upserted under canonical names in `appDataFolder` (`ALL NSE.csv`, `Reports-Daily-Multiple.zip`, `Holdings.csv`, `Positions.csv`, `Orders.csv`, `TRADEBOOK.csv`, `NSE Holidays.csv`), then processed immediately and the resulting brain is saved back online. A separate Refresh Data button is intentionally omitted because a completed upload already persists processed brain state; opening/reconnecting from another device loads that latest brain. Google authorization must be initiated with a user action on a new browser/device or after token expiry; the scanner does not implement its own login system. Mobile per-file ingestion is not part of the current workflow and would require a separate deliberate UI decision.

   If Drive authorization is stale, use the dedicated `Drive` button to reconnect, refresh the Drive file index, load the latest saved cloud brain, hydrate the latest canonical Drive inputs, and reload the latest dashboard. Do not force a fresh upload before the app becomes usable; stored Google Drive data is the recovery path. Once Drive is already connected, pressing `Load Files` opens the `Scanner Uploads` folder picker for a fresh upload.

   On page startup, if Drive authorization is missing or expired, stop before cloud hydration/render refresh work and show the reconnect state immediately. Browsers cannot silently renew Google access after expiry; a user gesture is required. The `Drive` button handles connect/reconnect and restore saved cloud state; `Load Files` only opens the folder picker and continues the upload/process flow when Drive is already connected.

   The loader (`ldSt` / `ldMsg` via `setLoading`) must be visible during startup cloud-brain/input hydration, Drive connection, cloud input upload, parsing/processing, cloud brain save, and final reload preparation. Do not show the app loader while the browser directory picker is merely waiting for the user to choose/cancel a folder; start it only after files are selected and processing begins.

   **Separate Drive/load actions**: the header uses a dedicated `Drive` button (`driveBtn`) for connect/reconnect and a stable `Load Files` button (`loadFilesBtn`) for folder selection. `Load Files` is enabled only while the Drive button is in the connected state; otherwise it is disabled and the Drive button is the only reconnect action. `Load Files` must not start Google OAuth and must not show the loader before the browser folder picker resolves. It should detect stale/revoked Drive access with a lightweight Drive check before opening the picker, then tell the user to press `Drive` to reconnect. Both Drive and Load Files must remain visible on mobile, including narrow phones such as iPhone mini widths. Space-saving mobile CSS may hide Export/Import/Reset, but never these two actions.

   Stocks feedback stores in the brain are `rs_recommend_outcomes_v1` (display-eligible recommendation cohorts and their five-session recommendation telemetry), `rs_entry_outcomes_v2` (actual executed recommended fresh buys/top-ups and five-session net profit-velocity outcomes), and `rs_post_sale_rockets_v1` (near-term escaped rockets after realised exits). Recommendation telemetry is global: it learns which feature patterns converted or failed, never whether a specific symbol should be remembered as good/bad. The Performance tab surfaces executed-entry feedback alongside shortlist conversion/outcome-score results and the post-sale evidence used by the learned hold/TGT policy.

   Performance `Position Size` is a learned sizing recommendation, not the current manual basket allocation. `getRecommendedPositionSize(perfStats)` derives a rupee position from post-system tradebook outcomes: median realised loss rupees as base risk, adaptive SL as risk distance, Kelly/payoff/profit-factor/expectancy as edge nudges, and loss-streak as a caution reducer. It is guarded to a sane range around observed average position size. Manual `Capital` and `Max Alloc` are only basket execution inputs, not the recommendation basis.

   Methodology display data in `rs_meth` is a cache only. Regime/session counts shown in Methodology must agree with the live accumulator stores (`rs_corr_bull`, `rs_corr_bear`, `rs_corr_neutral`); when rendering, prefer those accumulator counts and use cached `rs_meth.regimeSessions` only as fallback. Any methodology snapshot writer must preserve `useRegimeCorr`, `regimeSessions`, `avgMoveUniverse`, and `avgMoveAll`.

   On startup after Drive is connected, `loadSurvRules()` runs before `hydrateSessionCSVsFromWorkspace()` whether a saved brain exists or not; a freshly reset brain therefore seeds `SURV_SEED_RULES` before ZIP parsing. `hydrateSessionCSVsFromWorkspace()` uses `FS.readUploadText()` to prefer current cloud inputs over saved brain snapshots for `Holdings.csv`, `Positions.csv`, `Orders.csv`, `TRADEBOOK.csv`, and `NSE Holidays.csv`. It also reads cloud `Reports-Daily-Multiple.zip` via `FS.readUploadFile()` and parses all CSVs inside it, populating `NSE_BHAV`, `NSE_52W`, `NSE_SURV` etc. as soon as cloud storage is authorized.

   `TRADEBOOK.csv` may be a daily/incremental Zerodha export rather than full history. The full parsed tradebook is source-derived and is not persisted in the pruned brain. `keepFullerTradebookHistory()` therefore keeps only a tiny `rs_tradebook_meta_v1` count/date/source record in brain; if a later parsed tradebook is clearly a shorter recent slice than that metadata, it is ignored instead of replacing the active performance model with partial history. Orders/positions still provide latest-session display data until a new full tradebook is supplied.

   The Performance open-positions `Days Held` value is calculated from `openPositionLotsMap` as the quantity-weighted calendar age of the unmatched FIFO buy lots. A later top-up contributes only its own quantity and no longer resets the age of the entire position; live quantity above the last tradebook snapshot is treated as newly acquired quantity with age zero until the next complete tradebook refresh.

   Previously uploaded canonical inputs remain available in Drive for startup hydration after authorization (`hydrateSessionCSVsFromWorkspace()` reads holdings/positions/orders/tradebook/ZIP enrichment sources as needed). There is no background polling or separate refresh action.

   **Google configuration**: Google Drive API is enabled in the user's Google Cloud project; the OAuth consent screen remains in Testing with the owner's Google account as the allowed test user; the Web application OAuth Client ID authorizes `https://axionaut.github.io` as a JavaScript origin. The deployable public ID is embedded in `GOOGLE_DRIVE_CLIENT_ID`; `rs_google_client_id` remains only as a fallback for future replacement IDs. Never embed a Google client secret.

   **First cloud migration**: after this cloud-backed release is opened for the first time, connect Drive and import the existing `rocket_brain.json` backup once from the laptop before relying on cloud state elsewhere. `Import Brain` accepts both manually exported wrapper JSON and the raw auto-saved `rocket_brain.json` format for this migration. Subsequent uploads and brain writes remain online automatically.

4. **Version system**: `APP_VERSION` is an explicit integer release constant in `index.html`. The header and document title render it directly so laptop, phone, and any newly opened browser show the same version. Increment it once for each deployed code release; do not derive it from browser `localStorage`.
5. **Build timestamp**: `BUILD_TS` constant at top of `<script>` block holds the IST datetime of the last push (e.g. `2026-05-03 11:29 IST`). Injected by a PowerShell one-liner before every commit -- replaces the literal string in `index.html`. Displayed in the header as "Last updated: â€¦". **Push workflow must inject this before `git add`.**

---

## mRMR Engine -- Philosophy and Implementation

### Philosophy

Every day, regardless of market regime, there are stocks that move â‰¥10% intraday. These are **Rockets**. The engine's job is to find them *before* they move -- not explain them after.

The core challenge: you don't know in advance which of ~130 features (technical, fundamental, breadth, NSE-specific) will predict rockets. They change with market conditions. So rather than hardcoding rules or averaging many stale sessions, the engine uses the freshest lagged observation as the primary signal: previous-session features against today's rockets.

Historical/regime accumulators are retained as a fallback and diagnostic memory only. They are not averaged into the scoring vector when a usable fresh previous-day â†’ today rocket target exists. Recommendation and executed-entry feedback stores continue to be recorded for review, but they do not blend into mRMR scoring.

mRMR (Minimum Redundancy Maximum Relevance) solves a second problem: with ~130 features, many are correlated with each other. Naive averaging would over-represent those clusters. mRMR's redundancy penalty naturally picks the best representative from each cluster and down-weights the rest.

### Rocket Target (Binary 0/1)

The target is **binary 0/1** -- matching the legacy profitable engine. For each stock `i` in the filtered set:

```
qualitySet = topSetToday union goodRocketsToday
laggedTarget[i] = qualitySet.has(i) ? 1 : 0
```

`topSetToday` = stocks â‰¥ `ROCKET_THRESHOLD` today. `goodRocketsToday` = yesterday's rockets which remain above their collapse threshold today, using the historical fixed hold factor of `0.3`. `yesterdayRockets` remains available for display suppression. **Same-day correlation fallback is active** when `overlap < 100`.

### Featureâ€“Target Correlation (Relevance)

For each feature, compute `Pearson(feature_values, rocket_labels)` across all filtered stocks. Pearson requires â‰¥30 valid pairs; returns 0 otherwise. This is a point-biserial-style correlation using the binary 0/1 rocket target.

Primary scoring uses the fresh `targetCorrToday` vector whenever it has at least one finite non-zero correlation from the current previous-day â†’ today observation. Historical/regime correlations are used only when today's target is missing or all fresh correlations are zero/null.

### Featureâ€“Feature Correlation (Redundancy)

Every feature pair `(f, g)` is correlated: `O(nÂ²)` Pearson correlations. The redundancy of feature `f` is the mean of `|corr(f, g)|` for all other features `g`.

### mRMR Weight

```
weight(f) = relevance(f) / (1 + redundancy(f))
weights are then normalised to sum to 1
```

### Stock Score (0â€“100)

Each stock is **percentile-ranked** within today's filtered universe on each feature (`pctRank()` -- handles ties with average rank). The final score is the mRMR-weighted average of those percentile ranks, with direction correction: if a feature's correlation with rockets is negative (lower = better), the rank is flipped (`1 - rank`).

```
score = Î£ weight(f) Ã— (targetCorr[f] >= 0 ? rank(f) : 1 - rank(f))
        [normalised by maxW = sum of weights for features with non-null value]
rawFinal = maxW > 0 ? rawScore / maxW : 0.5
score = round(rawFinal Ã— 100 Ã— 10) / 10   // 1 decimal place
```

No qualitative multipliers are applied to the raw mRMR score.

### Accumulator

Three regime-specific accumulators -- `ACC_CORR_BULL`, `ACC_CORR_BEAR`, `ACC_CORR_NEUT` -- plus independently maintained combined `ACC_CORR` as fallback. Each uses a **running mean** blend (not EMA): `newCorr[f] = hist[f] + (today[f] - hist[f]) / newN`. `newN` is `learnSessions`: sessions with at least one rocket target, since an all-zero target cannot produce a correlation and must not dilute later observations. Total `sessions` remains available for regime history display. Scoring uses regime-specific correlations when `learnSessions â‰¥ 2`; otherwise falls back to combined `ACC_CORR`. For legacy brains saved before `independent_valid_target_v2`, the initial combined fallback is reconstructed as a session-weighted mean of saved regime vectors on the next engine run.

Session counting: `isNewSession = (!sessionTag || !ACC_CORR || ACC_CORR.lastTag !== sessionTag) && isMarketHours()` -- deduped by data hash, guarded by market hours.

**Scoring priority**: regime-specific (â‰¥2 sessions) â†’ combined `ACC_CORR` (â‰¥2 sessions) â†’ today's `learningCorr` â†’ 0.

**Stat bar regime counts**: read directly from `ACC_CORR_BULL/BEAR/NEUT` globals (loaded from brain on init), with `ENGINE_DATA.regimeSessions` as fallback. `ENGINE_DATA.regimeSessions` is only set after `runEngine()` runs.

### Lagged Correlation

When â‰¥100 stocks overlap between today's universe and yesterday's snapshot (`PREV_SNAP`), the engine uses **yesterday's feature values** correlated against **today's rocket labels**. If overlap < 100, including the first session with no `PREV_SNAP`, it falls back to **same-day correlation** (v2 behavior).

### Snapshot System

After every TV CSV upload, today's full feature vector for every filtered stock is saved compressed to brain as `{cols:[...featureKeys...], stocks:{sym:[val1,val2,...]}, savedDate (YYYY-MM-DD), regime, marketBreadth}`.

**Critical:** `savedDate` MUST use `getSessionDate()` (`YYYY-MM-DD`) format so it matches the load-side comparison. Earlier versions used `new Date().toDateString()` (`"Thu May 14 2026"`) which never equalled the ISO `todayISO`, causing today's snapshot to load as PREV_SNAP -- silent same-day correlation contamination. The load side has a `normDate()` helper that migrates legacy format to ISO so old snapshots continue to work.

**Two-key system** (`rs_snapshot` + `rs_snapshot_prev`):
- On page load and immediately before processing a scanner upload, choose the newest snapshot whose normalised `savedDate` is strictly before the current session and exactly one trading session earlier. Selection is by date, never by last upload order.
- On first upload of a new day: if existing `rs_snapshot` is from a previous day (or legacy format), archive it to `rs_snapshot_prev` before overwriting.
- **Staleness guard**: after loading the source snapshot, `tradingDaysBetween(normDate(snapDate), todayISO)` is computed using `NSE_HOLIDAYS` + weekend exclusion. If gap > 1 trading day, PREV_SNAP is discarded entirely; the next engine run behaves like a no-snapshot session and uses same-day fallback if it has rockets.
- PREV_SNAP in memory is never updated during the session -- all of today's uploads use the same PREV_SNAP.
- **Reset warm start**: `Reset Brain` clears learned correlations, rankings, methodology/performance caches, recommendations, saved filters, and all other accumulated state, but retains at most one date-validated stock prior-session snapshot plus `rs_nse_holidays` for adjacency validation. The retained snapshot is a comparison baseline only, not learned scoring state. It must be selected by `savedDate` as the immediately preceding trading session, never by last-processed upload order and never from the current session.

`PREV_SNAP_META` stores `{savedDate, regime, marketBreadth}` from the loaded snapshot -- used to determine the learning regime in lagged mode.

### Score Map (All Stocks Including Filtered-Out)

After scoring the filtered set, `SCORE_MAP` is extended to ALL parsed stocks (including hard-filter exclusions) using a binary search against the filtered percentile distributions. This allows scoring stocks that were excluded from the engine's training target -- their scores are valid but derived from a different distribution.

---

## Key Functions

| Function | Purpose |
|---|---|
| `runEngine(raw, sessionTag)` | Core mRMR scoring pipeline |
| `calcAutoVolume()` | Returns `minsFromOpen Ã— fVolMult`; clamped to market hours |
| `setAutoVolume()` | Updates `fVol` every 60s when `VOL_AUTO=true`; guarded by `_initInProgress` |
| `onVolChange()` | Toggles `VOL_AUTO` off when user manually enters volume |
| `renderStats()` | Stat cards: universe with filtered/full-list average absolute movement, SL/TGT, score spread, top sector, rockets today, regime, booked P&L. Performance is lazy, so current-window/trade-window context appears only after Performance has rendered. |
| `getFilterBarReason(s)` | Explains which active display filter hides an engine-scored candidate; Max Entry is intentionally not a filter |
| `toggleFilteredCandidates()` | Shows/hides a review-only list of high-score engine candidates hidden by display filters, held suppression, yday-rocket suppression, or top-20 cap |
| `keepFilteredCandidate(sym)` | Session-only override: keeps a filtered candidate in Rankings until refresh/upload/page reload; never persisted to filter state or brain |
| `computePerfStats(trips)` | Full KPIs from any trip slice |
| `getAdaptiveTradeTrips(trips)` | Applies the later of `SYSTEM_TRADE_START_DATE` and the rolling tradebook's first sell date, so adaptive stats ignore pre-system closed trades while preserving the full tradebook store |
| `renderPerformance()` | Performance tab render; populates `PERF_TRADE_WINDOWS` and `PERF_LATEST_SUMMARY` cache |
| `getRecommendedPositionSize(perfStats)` | Performance KPI helper: learned rupee position size from tradebook risk/edge. It is independent of manual Capital/Max Alloc basket inputs. |
| `renderMethodology()` | Methodology tab render |
| `computeAlloc(capital, selList)` | 2-pass score-weighted allocation with per-stock cap; top-up multiplier via `fTopupAlloc` |
| `getCols()` | Fixed + top-10 mRMR dynamic column list |
| `applyFilters()` | Filter ALLâ†’FILT -- applies price range, Min/Max 1D%, Min Market Cap when present (null/blank passes), held-stock suppression (HOLDINGS + POSITIONS + Orders.csv net buys), yday-rocket display suppression, hard cap at 20, render |
| `parseNSEHolidays(text)` | `NSE Holidays.csv` â†’ `NSE_HOLIDAYS` Set; persists to brain |
| `tradingDaysBetween(d1, d2)` | Calendar days from d1 to d2 minus weekends and `NSE_HOLIDAYS`; used for PREV_SNAP staleness check |
| `parseHoldings(text)` | Holdings.csv â†’ HOLDINGS, HOLDINGS_ALL, HOLD_COST_MAP |
| `parsePositions(text)` | Positions.csv â†’ POSITIONS `{symbol, qty, avg, ltp, pnl, isSell}` |
| `parseOrders(text)` | Orders.csv â†’ ORDERS_TODAY (COMPLETE only); sets `_loadedThisSession=true` |
| `normOrderDate(timeStr)` | Module-level helper: normalises Zerodha `DD-MM-YYYY HH:MM:SS` timestamps to `YYYY-MM-DD` |
| `getLatestOrderSession()` | Most recent Orders.csv date + rows for that date; uses `normOrderDate` for cross-month safety |
| `computeLatestOrderBooked()` | Latest Orders.csv booked P&L rows; gated on `_loadedThisSession`; returns null if no sell rows |
| `getLatestBookedSummary()` | Priority chain: Orders.csv (if `_loadedThisSession`) â†’ Tradebook (if `_loadedThisSession`) â†’ null |
| `parseTradebook(text)` | FIFO matching (consolidates fills first), charge calc, all KPIs, and net profit-velocity `exitPolicy` applied as `adaptiveSL`, `adaptiveTGT`, and `holdLimitDays` |
| `calcZerodhaCharges(price, qty, isSell, isIntraday, skipDp)` | Per-leg charge total; delegates to `calcZerodhaChargesSplit()` |
| `calcZerodhaChargesSplit(price, qty, isSell, isIntraday, skipDp)` | Per-component charge calculator; single fee formula source of truth |
| `exportBasket()` | Buy basket JSON export (Zerodha basket format â†’ `Zerodha_Basket_Buy.json`) |
| `showGttPopup()` | Removed -- functionality merged into Time-Stop Alert table |
| `getBuyPrice(s)` | Buy limit: `min(VWAP + 0.25Ã—ATR margin, LTP)` using TV CSV VWAP (`s.vwap`), tick-rounded |
| `getRunwayCeilingPct()` | Returns the 19.5% (`STOCK_RUNWAY_CEILING_PCT`) UC-style runway ceiling for the informational Max Entry helper. |
| `getMaxEntry(s)` | Max price to buy and still hit effective TGT before the stock UC-style runway ceiling -- `tickPrice(openPrice Ã— (1+19.5%) / (1+tgt%))`. Effective TGT includes missed-opportunity nudge when available. Returns null if price/change data is missing. |
| `isBuyZone(s)` | `max(price, getBuyPrice(s)) <= getMaxEntry(s) + PRICE_COMPARE_EPS` -- informational helper only while entry-ceiling filtering is disabled. |
| `getHoldingAvgCost(symbol)` | Avg cost priority: `HOLD_COST_MAP` â†’ `HOLDINGS_ALL` â†’ `POSITIONS[].avg`. `openAvgCostMap` excluded -- tradebook is one day late so sold positions still appear open there. |
| `initApp()` | Full init sequence: load cloud brain when Drive is authorized â†’ load/seed surveillance rules â†’ hydrate cloud inputs (including REG1 ZIP and `ALL NSE.csv`) â†’ leave Performance lazy â†’ render stats/methodology â†’ loadFilterState â†’ setAutoVolume â†’ applyFilters |
| `hydrateSessionCSVsFromWorkspace()` | Reads canonical cloud inputs from Drive after authorization; parses scanner/NSE/portfolio inputs into memory; sets `_loadedThisSession` on Orders/Tradebook; source-derived CSV state is not persisted back into brain |
| `processFiles(files)` | Accepts the selected directory contents, saves recognized inputs to Drive in the background, processes local files immediately, renders rankings without page reload, then background-saves the pruned brain |
| `saveFilterState()` | Save filters to `rs_filters` localStorage |
| `loadFilterState()` | Restore filters from `rs_filters` |
| `getSurvRules()` | Returns all rules from `SURV_CUSTOM_RULES` (deduplicated by key) -- flat list, all equal |
| `syncSurvRuleRows()` | Rebuilds surveillance rule rows from current rules; marks inactive rules (column not in last REG1 file) |
| `addSurvRule(col)` | Adds a rule to `SURV_CUSTOM_RULES`; persists to brain |
| `removeSurvRule(key)` | Removes a rule from `SURV_CUSTOM_RULES`; persists to brain |
| `persistMethodologySnapshot()` | Saves current methodology state to `rs_meth` |
| `buildHardFilterMethodologyHTML(E)` | Renders Surveillance Filters section only (sortable table, all rows removable). Core Filters section removed -- liquidity thresholds live in Rankings filter bar. |
| `sanitizeSavedMethodology(meth)` | Cleans stale methodology data on load |
| `computeMissedOpp()` | For each symbol sold today, takes best sell price across all fills, computes `max(0, (day_high âˆ’ best_sell) / best_sell Ã— 100)`, then stores `{avg, count}` in `rs_missed_opp_v2` keyed by date |
| `onRocketPctChange(resolvedThreshold?)` | No-op stub retained for engine post-run call site. Ceiling is applied directly in `applyFilters()` via `ENGINE_DATA.rocketThreshold`. |

---

## Global Variables

| Variable | Purpose |
|---|---|
| `ALL` | All stocks post-engine (score desc) |
| `FILT` | Filtered stocks after `applyFilters()` -- hard-capped at 20 |
| `SELECTED` | Set of selected symbols for basket -- reset to `new Set(FILT.map(s=>s.symbol))` by `applyFilters()` on every pass |
| `ENGINE_DATA` | mRMR weights, features, regime, metadata; persisted to `rs_meth` |
| `SCORE_MAP` | `{symbol â†’ rocketScore}` for ALL parsed stocks including filtered-out ones |
| `ACC_CORR` | Combined correlation accumulator `{corr:{}, sessions:N, lastDate, lastUpdated, laggedNote, regime}` -- regime-agnostic running-mean fallback |
| `PREV_SNAP` | Previous session feature vectors `{symbol â†’ {featureKey: value}}` -- frozen at page load |
| `PREV_SNAP_META` | `{savedDate, regime, marketBreadth}` from the loaded snapshot |
| `CURRENT_REGIME` | `'bull'` / `'bear'` / `'neutral'` -- set each engine run |
| `REGIME_THRESHOLDS` | `{bull: 0.55, bear: 0.35}` -- breadth fraction thresholds |
| `NSE_BHAV/52W/SURV/BULK/BLOCK` | NSE enrichment maps keyed by symbol |
| `NSE_NON_EQ` | `Set<symbol>` -- stocks in non-EQ series (BE, BZ, SZ, SM, ST) from REG1 Series column; excluded from both learning and display |
| `NSE_HOLIDAYS` | `Set<'YYYY-MM-DD'>` -- NSE trading holidays parsed from `NSE Holidays.csv`; used by `tradingDaysBetween()` |
| `HOLDINGS` | Active holdings (qty > 0) from Holdings.csv |
| `HOLDINGS_ALL` | All Holdings rows including closed (qty=0) |
| `HOLD_COST_MAP` | `{symbol: avgCost}` -- built from Holdings.csv (includes zero-qty closed positions) |
| `POSITIONS` | T+1 unsettled positions from Positions.csv `{symbol, qty, avg, ltp, pnl, isSell}` |
| `TRADEBOOK_STATS` | Full parsed tradebook. Key fields: `tripsData`, `lastDate`, `lastDayRows`, `lastDayTotal`, `lastBuyDateMap`, `openAvgCostMap`, `exitPolicy`, `adaptiveSL`, `adaptiveTGT`, `holdLimitDays`, `_loadedThisSession` |
| `LAST_BUY_DATE_MAP` | `{symbol â†’ latest buy date string}` -- from tradebook buy legs |
| `ORDERS_TODAY` | COMPLETE orders array from Orders.csv. `_loadedThisSession=true` when loaded this session (not from brain). |
| `VOL_AUTO` | Boolean: auto volume calculation active |
| `_tvLoadedThisSession` | `true` once a TV CSV has been processed this session |
| `_scanSavedDate` | ISO date string (`YYYY-MM-DD`) of the brain-restored scan's save timestamp (set on init, no longer actively used) |
| `_initInProgress` | `true` during `initApp()` until step 6; suppresses `applyFilters()` inside `setAutoVolume()` during startup |
| `REMOVED` | Hard-filter removal counts `{uc, surv, nonEq, liq, fscore, atr, deliv, fade, survRules:{ruleKeyâ†’count}, rockets:{uc:[],surv:[],nonEq:[],liq:[],fscore:[],atr:[],deliv:[],fade:[]}}`. **Never `Object.values(REMOVED).reduce` to total** -- `survRules` and `rockets` are nested. Always sum named scalar buckets. |
| `SUPPRESSED_HELD` | Count of stocks hidden because already held |
| `PERF_REGIME_FILTER` | `'all'` / `'bull'` / `'bear'` / `'neutral'` / `'untagged'` |
| `PERF_PERIOD_FILTER` | `'all'` / `'1m'` / `'3m'` / `'6m'` / `'1y'` |
| `PERF_TRADE_WINDOWS` | Cached Trading Windows rows -- read by `renderStats()` for current-window pill |
| `PERF_LATEST_SUMMARY` | Cached latest session summary from `renderPerformance()` -- read by `renderStats()` card. Single source of truth; no double computation. |
| `SURV_CUSTOM_RULES` | All surveillance rules `[{key, column, label}]` -- flat list, no built-in/manual distinction. Seeded from `SURV_SEED_RULES` on first load. Persisted in brain as `rs_surv_rules`. |
| `SURV_FILE_RULES` | `[{key, column, label}]` -- populated from actual REG1 file by `parseSurv`; used for add-rule datalist |
| `SURV_MISSING_RULES` | Declared/cleared empty Set; inactive rules are shown as inactive and skipped silently |
| `LIQ_MIN_VOL_DEFAULT` | Constant `500` -- default volume multiplier/floor. Used by `calcAutoVolume()` and as fallback when `fVolMult` is blank. |
| `_liqMinTurnover` | Runtime variable -- read from `fMinTurnover` input each engine run. Stock default is 10000000. No auto-calc. |
| `SURV_HEADERS` | Exact column headers from the loaded NSE REG1 file |
| `SURV_RULE_HITS` | `{ruleKey â†’ count}` -- stocks flagged per rule in last `parseSurv()` run |
| `SURV_ALL_HITS` | `{symbol â†’ {column: true}}` -- all flagged columns per symbol (for P&L correlation) |
| `SURV_CORR_ACC` | Surveillance P&L correlation accumulator; persisted to `rs_surv_corr` |

---

## Brain Keys (stored in `rocket_brain.json` via FS module)

`rocket_brain.json` is now pruned to learned/runtime state only. `FS.write()`, `FS.load()`, `FS.set()`, `FS.setMultiple()`, import, export, and reset all pass through `pruneBrainForStorage()`. Bulky source-derived CSV keys (`rs_data`, holdings, positions, orders, full tradebook stats) are rebuilt from canonical Drive/local inputs and are not written back into the brain. Tiny correctness metadata such as `rs_nse_holidays` and `rs_tradebook_meta_v1` is kept. Legacy non-stock/crypto keys are also dropped.

All keys below are read/written via `FS.get(key)` / `FS.set(key, val)`. **Never use `localStorage` for these.**

| Key | Contents |
|---|---|
| `rs_snapshot` | Today's feature vectors -- `{cols, stocks:{sym:[vals]}, savedDate, regime, marketBreadth}` |
| `rs_snapshot_prev` | Previous day's snapshot -- archived when first upload of a new day overwrites `rs_snapshot` |
| `rs_rec_count` | `{date: {symbol: count}}` -- Seen column counts |
| `rs_data` | Source-derived ALL stocks cache. Pruned from stored brain; rebuilt from `ALL NSE.csv`. |
| `rs_corr` | Combined accumulator (fallback when regime has <2 sessions) |
| `rs_corr_bull` | Bull regime correlation accumulator `{corr:{}, sessions:N, lastDate, ...}` |
| `rs_corr_bear` | Bear regime correlation accumulator |
| `rs_corr_neutral` | Neutral regime correlation accumulator |
| `rs_meth` | Methodology metadata (saved by `persistMethodologySnapshot()`), including `hardFilterSchema` so stale hard-filter counts from old parsing rules are ignored on load |
| `rs_rocket_lab_v1` | Bounded Rocket Lab evidence store: latest 15 compact daily sessions, up to 20 selected feature columns per symbol, walk-forward model metrics, and optional active lab overlay model. Kept intentionally compact so it does not recreate the old large-brain slowdown. |
| `rs_holdings` | Source-derived holdings cache. Pruned from stored brain; rebuilt from `Holdings.csv`. |
| `rs_tradebook` | Source-derived full tradebook stats + `tripsData`. Pruned from stored brain; rebuilt from `TRADEBOOK.csv`. |
| `rs_tradebook_meta_v1` | Lightweight tradebook guard `{tripsDataLength, roundTrips, firstDate, lastDate, sourcePath, lastModified}`. Kept in brain so partial tradebook exports can be detected without storing bulky `tripsData`. |
| `rs_orders` | Source-derived orders cache. Pruned from stored brain; rebuilt from `Orders.csv`. |
| `rs_positions` | Source-derived positions cache. Pruned from stored brain; rebuilt from `Positions.csv`. |
| `rs_regime_cal` | `{date â†’ regime}` calendar -- updated every engine run |
| `rs_missed_opp_v2` | `{date â†’ {avg, count}}` -- average missed-opportunity percent and symbol count per sell date |
| `rs_avg_move_universe_v1` / `rs_avg_move_all_v1` | Separate `{mean, sessions, lastDate}` running means of `abs(daily % change)` for the hard-filtered universe and complete parsed list. Updated once per calendar day (date-guarded, market-hours-guarded). Old `rs_avg_day_chg` high-excursion history is intentionally not reused. Shown in Universe as `avg |move| U X% / All X%` and, after 2 observations, `hist U X% / All X% (Nd)`. |
| `rs_intraday_ledger_v1` | Same-day scanner trajectory ledger `{date, mode, cols, samples:[{ts, tag, stocks:{sym:[vals]}}]}`. Used only as a bounded score supplement, not as labels or symbol memory. Resets naturally by date and keeps the latest 12 samples. |
| `rs_nse_holidays` | Array of `YYYY-MM-DD` strings -- NSE trading holidays from `NSE Holidays.csv` |
| `rs_surv_rules` | All surveillance rules array `[{key, column, label}]` -- seeded from `SURV_SEED_RULES` on first load |
| `rs_surv_corr` | Surveillance P&L correlation accumulator |

Legacy `_crypto` brain keys may remain in old backups as inert historical data. The active app neither reads nor writes them. **Reset Brain** clears active stock learning/runtime state and saved scanner filters while preserving only an immediately preceding, date-validated stock comparison snapshot and `rs_nse_holidays` needed to validate session adjacency. It intentionally leaves uploaded source input files in private Drive storage; startup after authorization may freshly rehydrate those cloud inputs.

## localStorage Keys (non-brain, stays in localStorage)

| Key | Contents |
|---|---|
| `rs_filters` | Filter state: minScore, priceMin, priceMax, fvol, volMult, minTurnover, fMin1D, fMax1D, capital, maxAlloc, rocketPct, reDrop, topupAlloc, sortCol, sortDir |
| `rs_google_client_id` | Public Google OAuth Web Client ID fallback when `GOOGLE_DRIVE_CLIENT_ID` is not embedded in `index.html` |
| `rs_cloud_provider` | Marker that Drive has previously been connected, used to show reconnect state after token expiry |
| `rscanner_ver` | Legacy browser-local version counter; no longer read after shared `APP_VERSION` release |

---

## Filter Bar

| ID | Label | Default | Notes |
|---|---|---|---|
| `fMinScore` | Min Score | 70 | Orange; floor at 70; step 0.5 |
| `fPriceMin/Max` | Price â‚¹ | blank / 1200 | Range filter; null/blank prices pass through as unknown |
| `fMin1D` | Min 1D % | blank | Min 1-day change filter |
| `fMax1D` | Max 1D % | 5 | Hide stocks already moved more than this today (explicit early-entry chase control). Empty = no max. |
| `fRocketPct` | Rocket % | 10 | Orange; threshold for what counts as a rocket (5â€“20%, step 0.5). Used by engine for labeling rockets in the learning step. Learning effect on next CSV upload. |
| `fVol` | Min Vol | auto | Cyan when auto-mode |
| `fVolMult` | Vol Ã— | 500 | Multiplier for auto vol (`LIQ_MIN_VOL_DEFAULT`) and stock liquidity hard filter |
| `fMinTurnover` | Min TV â‚¹ | 10000000 | Minimum stock turnover in â‚¹. |
| `fMinMarketCap` | Min MCap â‚¹ | 500000000 | Display filter using TradingView market cap / market capitalization when present. Null/blank market cap passes through. |
| `fCapital` | Capital â‚¹ | blank | Total allocation capital |
| `fMaxAlloc` | Max Alloc â‚¹ | learned Position Size | Per-stock cap in absolute â‚¹; defaults from the same learned `Position Size` value shown on the Performance tab when no user override is saved |
| `fReDrop` | Avg-dn % | 1 | Re-entry suppression threshold |
| `fTopupAlloc` | Top-up % | 50 | Allocation % for top-up candidates vs fresh buy |

**Liquidity thresholds** (`fVolMult`, `fMinTurnover`) are in the Rankings filter bar and feed `_liqMinVol` / `_liqMinTurnover`. No `CORE_FILTERS` intermediary. The `rs_core_filters` localStorage key is no longer used. `fMinMarketCap` is a separate display filter; it checks `marketCap` only when the value is present, so null/blank market cap rows pass through as unknown.

**Filter results are hard-capped at 20 rows** to match the Zerodha basket limit.

**Max 1D % filter** (`fMax1D` input, default 5): drops stocks where `priceChange > fMax1D`. Empty = no max.

**Max Entry reference**: Max Entry = highest price where a stock could still hit effective TGT before the stock UC-style runway ceiling (`STOCK_RUNWAY_CEILING_PCT = 19.5`). Formula: `tickPrice(openPrice Ã— (1 + 19.5%) / (1 + tgt%))`. Effective TGT includes missed-opportunity nudge when available. This is currently informational only; `applyFilters()` and `exportBasket()` must not reject solely because current/buy price has crossed Max Entry.

**Low-overlap learning guard**: Mature brains must not fall back to same-day correlations when lagged overlap is thin. If the current filtered universe has fewer than 100 prior-snapshot matches and the brain already has learned sessions, `targetCorrToday` stays null and scoring uses historical regime/combined correlations. Same-day fallback is cold-start only. This prevents the engine from becoming a pure momentum/chase mirror when snapshots are sparse.

**Buttons in filter bar:**
- `ðŸ§º Buy Basket (N)` -- exports `Zerodha_Basket_Buy.json`. Enabled when â‰¥1 stock selected.

---

## Held-Stock Suppression (`applyFilters`, Stocks Mode Only)

Three sources are checked for held positions:

1. `HOLDINGS` (settled, qty>0) â†’ `HOLD_COST_MAP` or `h.avgCost` for avg
2. `POSITIONS` (T+1 unsettled) -- overwrites HOLDINGS for same symbol
3. `ORDERS_TODAY` net buys for today's session date (stocks bought but not fully sold today) -- uses `normOrderDate()` for date matching; also suppresses stocks fully round-tripped today (buy+sell same session)

For each held stock:
- `qty â‰¤ 0` (short or zero) â†’ suppress
- No avg data â†’ suppress
- Price dropped `â‰¥ dropPct%` below avg â†’ show as top-up candidate (`_isTopUp=true`, reduced allocation via `fTopupAlloc`)
- Otherwise â†’ suppress

Top-up candidates get `_isTopUp=true`, `_heldAvg`, `_heldQty`, `_topUpDrop` fields set. Allocation uses `effective_score = score Ã— (fTopupAlloc / 100)`.

---

## Max 1D % Filter

Explicit user filter via `fMax1D` input in the filter bar (default 5). `applyFilters()` drops stocks where `priceChange > fMax1D`. Empty = no max.

**Separate from Max Entry**: `fMax1D` is a manual ceiling the user sets and remains an active filter. `isBuyZone()` / `getMaxEntry()` provide the calculated buy ceiling as an informational reference only. `Rocket %` is not used for runway.

---

## Rocket Lab Evaluator

Rocket Lab is the model-promotion loop for the original mission: catching next-session rockets, not merely finding 3-4% tradable moves.

- Every scanner run stores a compact daily session in `rs_rocket_lab_v1`: all parsed symbols, current score, hard-filter eligibility, and up to 20 selected numeric features. The store is capped to the latest 15 sessions.
- Walk-forward evaluation ranks day D using only day-D data, then checks actual rockets on day D+1. Metrics include hit@20, recall@20, recall@50, and precision@20.
- Candidate models currently evaluated: current mRMR, RVOL early, quiet accumulation, sector breakout, and durable momentum.
- Rocket Lab is not only a report: if a non-current model has at least 3 evaluated days and beats current mRMR on recall@20 or recall@50, it becomes the active overlay. Live `rocketScore` then blends 78% current mRMR with 22% the active lab model's normalised score.
- The overlay is deliberately conservative. First sessions only collect evidence; no experimental model affects live ranking until it has walk-forward proof.

---

## Charge Calculation (`calcZerodhaChargesSplit`)

**Source of truth**: `Zerodha Equity Trading Charges.csv` in the workspace root. Always refer to it before changing any rate.

| Charge | Delivery (CNC) | Intraday (MIS) |
|---|---|---|
| Brokerage | â‚¹0 | `min(0.03% Ã— value, â‚¹20)` per order |
| STT | 0.1% on **both** buy and sell | 0.025% on **sell side only** |
| Exchange txn | 0.00307% both sides | 0.00307% both sides |
| SEBI | 0.0001% both sides | 0.0001% both sides |
| GST | 18% on (brokerage + txn + SEBI) | same |
| Stamp | 0.015% Ã— buy value | 0.003% Ã— buy value |
| DP | â‚¹15.34 per ISIN per sell day | â‚¹0 |

**Intraday detection**:
- **Tradebook**: `holdDays === 0` (closed position)
- **Orders.csv**: `isSameDay = buys.length > 0` (any same-day buy+sell)

**DP deduplication**: `dpCharged` Set tracks `sym|sellDate`. First sell trip charges DP; subsequent trips for same ISIN on same sell day pass `skipDp=true`.

---

## SL/TGT

- `deriveProfitVelocityPolicy(tripsData, baselineSL, baselineTGT)` is the unified exit feedback loop. It uses net-of-charges closed FIFO lots and evaluates observed close horizons of 1/2/3/5/7/10/15/20/30 days.
- Its objective is maximum observed net `% / holding day`, penalised for downside and weak sample size. The selected horizon becomes `holdLimitDays` and drives open-position review timing.
- `adaptiveTGT` starts from `medianWinPct`, then blends toward the speed-weighted median net winner among trades closed within the learned horizon. `adaptiveSL` starts from `|medianLossPct|`, then can tighten toward the speed-weighted lower loss magnitude; it never widens beyond the baseline median loss.
- This is an observational policy, not a counterfactual backtest: `TRADEBOOK.csv` records realised exits but does not contain each position's daily/intraday path needed to prove alternate TGT or SL fills.
- `avgChargePct` = mean of `charges / (buyValue + sellValue) Ã— 100` across all valid trips -- charges as % of round-trip turnover. Stored in `TRADEBOOK_STATS.avgChargePct`. Shown in SL/TGT stat card as `cost ~X%`.
- `getEffectiveTgtPct()` = `adaptiveTGT + getMissedOppNudge()`, rounded to nearest 0.05%
- No ATR multiplier -- target is the profit-velocity target plus missed-opportunity adjustment
- Per-stock fallback (no tradebook): `slPct = -(atr Ã— 1.5)`, `tgtPct = max(atr Ã— 1.5 Ã— 1.5, |weekly_move / 5|)`
- All prices tick-rounded to â‚¹0.05 via `tickPrice()`
- `getMissedOppNudge()` is added to effective TGT and is used in SL/TGT display, Max Entry, allocation expected-net feedback, open-position target prices, and basket/GTT target export.

---

## Allocation (`computeAlloc`)

- `Capital ₹` and explicit user-entered `Max Alloc ₹` are persisted in `localStorage` under `rs_filters_shared`. When `Max Alloc ₹` is blank and a learned Performance `Position Size` is available, `fMaxAlloc` is auto-filled from that same recommendation.
- **Pass 1**: Score-weighted initial allocation. `effectiveScore = score Ã— topupMult` for top-up candidates. Each stock gets `capital Ã— (effectiveScore / totalEffectiveScore)`, floored to whole shares, capped at `fMaxAlloc`.
- **Pass 2**: Residual redistribution. Loop: add 1 share to highest-effective-score stocks not yet at cap, until residual < cheapest stock price.
- Buy price = `getBuyPrice(s)`: `VWAP + 0.25 Ã— ATR_margin` if VWAP>0, else LTP. Tick-rounded to â‚¹0.05.
- `evalNet()` computes expected net P&L at effective TGT% for each allocation (shown in status bar).

---

## Basket Export

### Buy Basket (`exportBasket()` â†’ `Zerodha_Basket_Buy.json`)
- Zerodha basket JSON with `variety: 'regular'`, `product: 'CNC'`
- `price`: buy price from `getBuyPrice()` (VWAP + ATR margin)
- Basket export splits each stock's allocated quantity into two buy orders when quantity is >=2: the first leg exits at `getEffectiveTgtPct()` and the runner leg exits at `2 * getEffectiveTgtPct()`. Both legs use the same `stoploss: -adaptiveSL` percentage GTT value. Odd quantities are split as close to half as possible, with the extra share on the normal-target leg. Quantity 1 remains a single normal-target order.
- Quantity: total stock quantity comes from `computeAlloc()` if Capital set; else 1 share per stock before split handling
- Capped to 20 orders (Zerodha basket limit)
- `exchangeToken` and `instrumentToken` set to 0 -- Zerodha resolves by symbol name

### GTT / Exit Reference
- `showGttPopup()` has been removed. Target/SL reference values now live in the Performance tab's Open Positions panel and Time-Stop Alert table.
- Open Positions merges current Holdings.csv + Positions.csv and shows Target â‚¹ (+effective TGT%) and SL â‚¹ (-adaptiveSL%) for manual GTT/exit handling.
- Days Held is the quantity-weighted calendar age of unmatched FIFO buy lots in `TRADEBOOK_STATS.openPositionLotsMap`. If live quantity exceeds the full-tradebook open quantity, only that excess is a new zero-day top-up until the next tradebook refresh; if it is lower, FIFO-depleted oldest lots are removed first.

---

## Stock Table

- **All tables sortable** -- click any column header
- **Fixed columns**: checkbox (select-all), Score, Symbol (with seen count sub and filtered/kept/top-up badges), Price â‚¹, Chg%, Deliv%, Alloc â‚¹, Volume. Max Entry is not currently a fixed column or a hidden gate.
- All displayed currency values must use exactly two decimal places. Use the shared helpers in `index.html` (`fmtINR`, `fmtSignedINR`, `fmtNegINR`, `INR_2`) instead of ad hoc `toLocaleString()` or rounded rupee displays.
- **Seen count**: grey (1Ã—), amber (2Ã—), green (3Ã—+) shown as superscript next to symbol
- **Top-up candidates** shown with fire `â†‘ TOP-UP` badge and reduced allocation
- **Dynamic columns**: top 10 mRMR features by weight -- skips fixed column duplicates and all-null columns
- **SL% / TGT%**: not shown as fixed columns but stored per stock; used in allocation and basket export
- Table hard-capped at 20 rows (Zerodha basket limit)

---

## Performance Tab

- **Period filter**: All / 1M / 3M / 6M / 1Y -- filters sell-dates included in KPIs. Default = All.
- **Regime filter**: All / Bull / Bear / Neutral / Untagged -- filters trips by observed sell-date regime.
- **Regime tagging**: each trip is tagged only when its exact sell-date exists in `rs_regime_cal`. Never infer historical trip regimes from the nearest scan date or current regime; otherwise one fresh post-reset scan can relabel the full historical tradebook. Trades without an observed sell-date regime remain `untagged`.
- **Metrics**: net P&L, expectancy (â‚¹/lot), profit factor, win rate, profitable days %, avg P&L/trading day (days with trades), avg P&L/cal day (totalNetPnlRs Ã· calendar days in period), largest win/loss, max win/loss streak, avg hold days, learned hold cap/observed net velocity, max drawdown
- **Regime Returns card**: Bull/Bear/Neutral/Untagged breakdown -- always full history, unaffected by period/regime pills. Untagged shows closed lots lacking an observed sell-date regime.
- **Win/loss classification**: based on **net P&L after charges**, not gross.
- **Exit policy**: `adaptiveSL`, `adaptiveTGT`, and `holdLimitDays` come from the net-of-charges profit-velocity policy. The Performance KPI card shows the learned hold cap and the observed net `%/day` cohort supporting it. Effective TGT adds missed-opportunity nudge on top.
- **Trading Windows table**: merged 30-min bucket table, buy and sell columns side-by-side. Signal is median-relative ("Enter" / "Exit" / "Enter + Exit" / "--"). Cached in `PERF_TRADE_WINDOWS`.
- **Current-window pill**: shown in `renderStats()` -- reads current IST 30-min bucket from `PERF_TRADE_WINDOWS`. Requires `renderPerformance()` to run first.
- **Monthly breakdown**: always full regime-filtered history (not period-filtered). Columns: Month, Net P&L, Lots, Trading Days, Avg/Trading Day, Cal Days, Avg/Cal Day. Cal Days = span from first to last sell date within the month (not full calendar month, so partial months are correct).
- **Latest Session panel**: Both the stat card and the Performance tab table use `getLatestBookedSummary()` which picks whichever of Orders.csv or Tradebook has the **newer date** (both must be `_loadedThisSession`). Handles GTT-triggered sells that appear in Tradebook a day after Orders.csv. Delivery sells use `getHoldingAvgCost()` (Holdings â†’ Positions). "avg cost?" only shows if all sources fail. The table shows net P&L in â‚¹ and as a percentage of buy-side deployed capital; its footer percentage is based on total known deployed capital rather than an unweighted average.
- **Open Positions panel**: shown above KPIs, below Latest Session. Renders only when HOLDINGS or POSITIONS have data. **Columns**: Symbol, Qty, Avg â‚¹, LTP â‚¹, P&L%, P&L â‚¹, Capital â‚¹, Days Held, Target â‚¹ (+effective TGT%), SL â‚¹ (-adaptiveSL%), TSL 1 Trigger â‚¹, TSL 2 Trigger â‚¹, Signal. Days held is highlighted against the learned `holdLimitDays`, and the evidence line reports outcomes beyond that horizon. **TSL 1/2** are reference-only trailing stops for the split-GTT system, persisted in `rs_position_tsl`, never exported to Zerodha while Kite TSL remains beta. TSL 1 uses the base target leg and TSL 2 uses the runner leg. For each leg, trigger = `LTP - gap points`, where gap percent is `max(half target %, daily ATR%)`; displayed step points are Zerodha's minimum favorable-move trail step for the price band. Legacy `tsl` aliases point to the runner leg. **Signal** = composite exit urgency -- equal-weight average of `P&L%, P&L â‚¹, âˆ’Days Held, Dist-to-SL`, all cross-normalised to [-1,+1] across current rows. Formula: `(nPnlPct + nPnlRs âˆ’ nDays + nDistSL) / 4`. Lower = more urgent to exit. Days Held is sign-flipped so holding losers longer worsens signal. Dist-to-SL = `(ltp âˆ’ slPrice) / slPrice Ã— 100`. `daysHeld=0` positions get null (shown at bottom). Header shows negative/positive counts and evidence line. **Days Held source**: quantity-weighted remaining FIFO buy-lot age from `TRADEBOOK_STATS.openPositionLotsMap`, reconciled against live quantity so a small later top-up does not reset the full holding age.
- **`parseTradebook`**: consolidates fills (groups by sym+date+type, qty-weighted avg price) before FIFO matching.
- **Init render order**: Performance is lazy. `initApp()` renders rankings/stats first and leaves a placeholder in the Performance tab until the user clicks it. `PERF_TRADE_WINDOWS` and `PERF_LATEST_SUMMARY` are populated only after `renderPerformance()` runs.

---

## Live P&L Panel (Booked Today / Latest Session)

- `computeLatestOrderBooked()` -- gated on `ORDERS_TODAY?._loadedThisSession`. Returns null if no sell rows (prevents showing â‚¹0 on buy-only days).
- `getLatestBookedSummary()` -- priority chain: Orders.csv â†’ Tradebook (both require `_loadedThisSession`) â†’ null. Never shows brain-cached stale P&L.
- Stale-data banner removed -- stat cards always show whatever is in brain/memory without a warning overlay.

---

## Surveillance Filtering (`parseSurv`)

- **Symbol column detection**: `findHeader()` with patterns `/^symbol$/i`, `/^nse.?symbol$/i`, `/^trading.?symbol$/i`, `/^scrip.?symbol$/i`.
- **`isSurvFlag(v)`**: trimmed value is non-empty AND not `'100'`. Only `100` means compliant -- any other non-empty value (scores like 75, 50, 0, or text) is a flag.
- **Active rules = `SURV_CUSTOM_RULES` only**: stocks are flagged ONLY for rules the user has added to the surveillance table in methodology. REG1 file columns that aren't in `SURV_CUSTOM_RULES` do NOT trigger the badge. `SURV_FILE_RULES` still lists every file column for the "add rule" datalist so the user can browse and add new rules -- but until they're added to `SURV_CUSTOM_RULES`, they have no flagging effect.
- **`SURV_FILE_RULES`**: populated from actual REG1 file columns `[{key, column, label}]`. Used for the Surveillance P&L correlation table and add-rule datalist.
- **`getSurvRules()`**: returns all entries in `SURV_CUSTOM_RULES` (deduplicated by key). No built-in/manual distinction. Seeded from `SURV_SEED_RULES` on first load.
- **Column rename handling**: `parseSurv` checks each rule key against current REG1 file columns. If matched (case/spacing change only), stored column name is silently updated. If not found, rule shown as "Inactive" with a Remove button.
- **`SURV_MISSING_RULES`**: declared/cleared empty Set. Orphaned rules are shown inactive in methodology and skipped silently.
- **`NSE_SURV[sym]`**: array of rule keys that flagged the symbol (first entry = primary rule for `REMOVED.survRules`). **Note**: always compare against rule keys, never raw column names -- `NSE_SURV[sym].includes(row.key)`, not `=== row.column`.
- **Add-rule datalist**: built from `SURV_FILE_RULES`, excluding columns already configured. Falls back to filtering `SURV_HEADERS` if `SURV_FILE_RULES` is empty.
- **`buildHardFilterMethodologyHTML(E)`**: Renders Surveillance Filters section only -- sortable table of REG1 columns, all with Remove buttons. Core Filters section removed; liquidity controls moved to Rankings filter bar.
- Surveillance P&L correlation table (`buildSurvCorrHTML`): columns = Surveillance Column, Holdings Flagged, Avg Unrealised P&L%, Signal, Held Positions (symbol+P&L pills from HOLDINGS + today's ORDERS_TODAY net buys).

---

## Time / Session Logic

- IST computed via UTC + 5.5h offset (`istNow()`)
- Market hours: 9:00â€“16:00 IST (`DAY_START_MIN=540`, `DAY_END_MIN=960`)
- Correlations only accumulated during market hours (`isMarketHours()` guard in `isNewSession`)
- Session date: 9:00â€“16:00 IST = today's calendar date; post-16:00 IST = next day (treated as tomorrow's session)
- Auto volume: `max(1, minsFromOpen) Ã— fVolMult` (default 500); updated every 60 seconds when `VOL_AUTO=true`

---

## Init Flow (`initApp`)

```
1. FS.init() â†’ load brain file (or set _pendingHandle for reconnect)
2. Restore from brain: PREV_SNAP, correlations, ALL/FILT, ENGINE_DATA, holdings, positions (today only), tradebook, orders (no _loadedThisSession -- from brain)
3. loadSurvRules() â†’ restore configured rules or seed defaults for a fresh/reset brain before any REG1 parsing
4. hydrateSessionCSVsFromWorkspace() â†’ read current cloud CSV files/REG1 ZIP from Drive â†’ sets _loadedThisSession on Orders/Tradebook and rebuilds surveillance hits using active rules
5. renderPerformance() (must be before renderStats)
6. renderStats()
7. renderMethodology()
8. loadFilterState()
9. setAutoVolume()
10. Show dash/header (must be before applyFilters so renderTable works into a visible element)
10. _initInProgress = false
11. applyFilters() -- first clean render with all state restored
```

`_initInProgress = true` at declaration (line ~771). Set to `false` at step 10. Guards `setAutoVolume()` from firing `applyFilters()` prematurely during `loadFilterState()`.

---

## processFiles Flow (File Upload)

`Load Files` opens the browser directory picker first on platforms that support folder access. If the user selects the Rocket Scanner workspace folder, the app reads inputs from its `Scanner Uploads` child and mirrors the live brain to workspace `rocket_brain.json`; if the user selects `Scanner Uploads` directly, inputs are read there and the local brain mirror is written there. Drive must already be connected via the dedicated `Drive` button. After the local folder is selected, canonical inputs are saved to Drive in the background while rankings are built immediately from the selected local files. The pruned brain is also saved in the background after rendering.

```
1. Route files by name (tvFile, nseZip, holdFile, posFile, ordFile, tbFile). `ALL NSE.csv` is the scanner universe input.
2. If nseZip exists: unzip â†’ detectNSE() for each CSV (NSE_BHAV, NSE_52W, NSE_SURV etc.).
3. If `tvFile` is detected, it must contain "all nse" and updates the stock scanner:
   a. parseCSV() â†’ raw rows
   b. Compute sessionTag from filename + row count + data hash
   c. runEngine(raw, sessionTag) â†’ ALL
   d. Save snapshot (archive previous day's if date changed)
   e. _tvLoadedThisSession = true
   f. (no DOM updates -- reload handles all rendering)
4. The stock scanner writes learned stock namespace state and execution-feedback state, but not source-derived scan rows.
5. Parse holdFile, posFile, ordFile (sets _loadedThisSession), tbFile (sets _loadedThisSession).
6. Run `computeMissedOpp()` when stock scanner data was processed.
7. `renderTradingDashboardNow()` renders methodology/rankings without page reload.
8. `saveBrainInBackground()` flushes the pruned brain asynchronously; Drive/input saves may still be finishing after rankings appear.
```

Rendering after file upload is explicit and immediate; there is no forced reload after `processFiles()`.

---

## Live Cross-Tab Refresh

- UI changes should refresh every affected view immediately whenever the needed source data is already in memory or available from connected Drive storage.
- Surveillance filter add/remove first calls `rebuildActiveSurveillanceHits()` to rebuild `NSE_SURV` / `SURV_RULE_HITS` from already-loaded `SURV_ALL_HITS`, then calls `refreshRankingsAfterSurvRuleChange()`: it hydrates cloud surveillance data if needed, reruns the stock engine against `window._lastRawTV` or cloud `ALL NSE.csv`, updates `ALL`, `FILT`, methodology, stats, tab counts, and persisted `rs_data` without waiting for a new upload.
- Surveillance refresh reuses `window._lastScannerSessionTag` / `ACC_CORR.lastTag` so the recalculation does **not** count as a new learning session.
- Only source-data changes that are not available in memory or connected Drive storage should ask for a fresh upload.

---

## Missed Opportunities (`rs_missed_opp_v2`)

- `computeMissedOpp()` runs after every file upload -- requires both `ORDERS_TODAY` (Orders.csv) and `ALL` (TV CSV) to be loaded; bails silently if either is missing
- For each symbol sold today: groups all fill rows by symbol, takes the **best (highest) sell price** to get the most conservative missed% estimate
- `missed% = max(0, (day_high âˆ’ best_sell_price) / best_sell_price Ã— 100)` -- recorded for ALL sold symbols where day high is known (including 0% for perfect exits). No threshold filter -- average reflects true exit quality across all sells, not just bad ones.
- Stored in brain as `{date â†’ {avg, count}}`. Accumulates across dates; today's key is overwritten on each run.
- `getMissedOppNudge()` uses all dates (no regime filter) -- count-weighted average across all sell dates, returns `mean Ã— 0.25`. No cap.
- `getMissedOppNudge()` is added to effective TGT. This affects SL/TGT display, Max Entry, Open Positions target prices, expected-net feedback, and basket/GTT target export. Shown in: SL/TGT stat card subtitle (amber, "missed opp +X%") and missed-opp info pill ("TGT +X%").
- `computeAlloc().evalNet()` uses `getEffectiveTgtPct()` for expected-net/charges math, falling back to stock ATR `tgtPct` only if no effective target is available.

---

## Observation Counting

- Each TV CSV upload accepted by the engine during market hours counts as one **observation**. `isNewSession` check: `(!sessionTag || !ACC_CORR || ACC_CORR.lastTag !== sessionTag) && isMarketHours()`. Session dedup is by data hash -- same data re-uploaded doesn't double-count.
- Each observation increments the current learning regime's accumulator sessions count.
- Shown in: Regime stat card and Methodology tab (not in Performance tab regime pills -- pills show only regime name and current-regime dot, no session counts).

---

## Header

- **Favicon**: rocket emoji `ðŸš€` via SVG data URI in `<head>`
- **Header buttons**: dedicated `Drive` auth/reconnect action, stable `Load Files` action, `ðŸ’¾ Export`, `ðŸ§  Import`, and one destructive `ðŸ—‘ Reset Brain` action. `Drive` handles Google authorization/reconnect and reloads the latest saved dashboard. `Load Files` only opens the local folder/file picker and processes inputs; if Drive is not connected, it shows a Drive-connect prompt instead of starting OAuth itself. Reset Brain clears learned/runtime stock brain state and saved scanner filters while retaining only a valid prior-session stock comparison snapshot plus the NSE holiday calendar used to validate adjacency; it does not delete uploaded source CSV/ZIP files from Drive.
- **Tab sizing**: `#mainTabs .tab` has CSS override `padding:8px 12px;font-size:12px` to keep 3 tabs + 5 buttons in one row
- **`.hdr-r` gap**: `6px`

---

## Known Issues / Limitations

- Zerodha sell basket JSON does not support GTT -- buy baskets export percentage target/SL GTT values, while existing/open positions still need manual Target â‚¹ / SL â‚¹ handling from the Open Positions panel.
- BSE exchange txn rate may differ from NSE (uniform 0.00307% used for both)
- "Other credits & debits" in Zerodha P&L (clearing charges, IPFT levy) not modelled
- `exchangeToken` and `instrumentToken` in basket JSON are set to 0 -- Zerodha resolves by symbol name
- Rocket threshold is configurable via `fRocketPct` (5â€“20%, default 10%) -- it updates rocket labels/counts immediately, but learning effects (label re-assignment, correlation re-fit) require a fresh CSV upload. It does not drive Max Entry runway. Recommendation feedback uses this threshold as the five-session conversion target, but stores a continuous outcome score so failed picks can create negative global feature feedback.
# Latest Architecture Note - 2026-06-11

- The app is split into `index.html` (markup), `styles.css` (styling), and `app.js` (scanner logic). Keep future edits in the relevant file instead of rebuilding a monolithic HTML file.
- Rocket learning is intentionally regime-agnostic. The scanner keeps one combined running correlation accumulator (`rs_corr`) across all market conditions.
- Market breadth remains available as continuous context/diagnostic data, but it must not create separate bull/neutral/bear scoring histories.
- Deprecated brain keys are pruned on storage/import: `rs_corr_bull`, `rs_corr_bear`, `rs_corr_neutral`, and `rs_regime_cal`.
- Performance reporting should evaluate actual outcomes by period/trade behavior, not by inferred sell-date regime buckets.
