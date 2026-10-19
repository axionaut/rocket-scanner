#!/usr/bin/env python3
"""Rocket Scanner - Study: historical 1-minute data collector and local server.

A separate experiment, independent of the trading app and of the trading helper (localhost:8787).
It never writes into the scanner's stores and nothing here feeds scoring, targets or orders.

What it does
  1. Builds the trading calendar from NSE's own daily bhavcopy (sec_bhavdata_full_DDMMYYYY.csv):
     a date is a session exactly when NSE published a bhavcopy for it (holidays have none; special
     sessions such as Muhurat or a weekend Budget session do).
  2. For every session in the window ranks the equity universe by end-of-day gain,
       gain % = (CLOSE_PRICE - PREV_CLOSE) / PREV_CLOSE * 100     (NSE's own prices, unrounded)
     and keeps the top 30. A stock that wins on several days is kept once per day.
  3. Fetches every 1-minute candle Kite holds for each winner on its winning day and on the two
     market sessions before it, and stores the response exactly as Kite returned it.
  4. Serves the stored data to the Study tab on http://localhost:8790 (read-only).

Nothing is ever filled in: a minute with no candle stays absent, a session Kite has no data for is
recorded as empty, a symbol with no instrument token is recorded as such. Resuming never refetches
a stored (symbol, series, date) - the database key makes duplicates impossible.

DATA NEVER GOES IN THE REPO. The repo is public and NSE terms forbid redistributing market data, so
the database lives outside it (default ~/RocketScannerStudy/study.db).

Usage
  python3 study_collect.py serve                 # server; collection is started from the Study tab
  python3 study_collect.py collect               # bhavcopies + winners + candles from the terminal
  python3 study_collect.py collect --stage bhav  # only calendar, bhavcopies and winners
  python3 study_collect.py verify                # completeness / chronology / gain re-check report

Kite credentials (only needed for candles): KITE_API_KEY and KITE_ACCESS_TOKEN in the environment,
or --api-key/--access-token, or a JSON file via --token-file, or pasted into the Study tab (held in
memory only, never written to disk). The access token is the same daily Kite Connect token the
helper uses; Kite allows the same token in several clients.
"""
import argparse
import csv
import datetime as dt
import gzip
import io
import json
import os
import sqlite3
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCHEMA_VERSION = 1
DEFAULT_DIR = Path(os.environ.get('ROCKET_STUDY_DIR', Path.home() / 'RocketScannerStudy'))
DEFAULT_PORT = 8790
TOP_N = 30
PRIOR_SESSIONS = 2
DEFAULT_SERIES = ('EQ', 'BE', 'BZ')        # NSE main-board equity series; --series to change
BHAV_URL = 'https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{d}.csv'
KITE_ROOT = 'https://api.kite.trade'
HELPER = 'http://localhost:8787'           # trading helper: only its instrument file is read
KITE_MIN_INTERVAL = 0.36                   # Kite historical limit is 3 requests/second
KITE_MAX_SPAN_DAYS = 60                    # Kite limit for one minute-interval request
BHAV_PAUSE = 0.25                          # politeness between NSE archive requests
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ── storage ──────────────────────────────────────────────────────────────────────────────────────
DDL = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
-- one row per probed calendar date: 'session' (bhavcopy exists) or 'none' (NSE has no file)
CREATE TABLE IF NOT EXISTS calendar(date TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT, probed_at TEXT);
-- the bhavcopy file exactly as received, for provenance and re-derivation
CREATE TABLE IF NOT EXISTS bhav_files(date TEXT PRIMARY KEY, source TEXT, raw BLOB NOT NULL, rows INTEGER);
CREATE TABLE IF NOT EXISTS bhav(
  date TEXT NOT NULL, symbol TEXT NOT NULL, series TEXT NOT NULL,
  prev_close REAL, open REAL, high REAL, low REAL, last REAL, close REAL, avg REAL,
  qty REAL, turnover_lacs REAL, trades REAL, deliv_qty REAL, deliv_per REAL,
  PRIMARY KEY(date, symbol, series));
CREATE TABLE IF NOT EXISTS winners(
  date TEXT NOT NULL, rank INTEGER NOT NULL, symbol TEXT NOT NULL, series TEXT NOT NULL,
  gain_pct REAL NOT NULL, universe INTEGER NOT NULL, tie_at_cutoff INTEGER NOT NULL DEFAULT 0,
  prior1 TEXT, prior2 TEXT,
  PRIMARY KEY(date, rank), UNIQUE(date, symbol, series));
-- Kite candles: one row per (symbol, series, date). raw = zlib(JSON array exactly as Kite sent it)
CREATE TABLE IF NOT EXISTS candles(
  symbol TEXT NOT NULL, series TEXT NOT NULL, date TEXT NOT NULL,
  status TEXT NOT NULL,            -- ok | empty | no_token
  token INTEGER, tradingsymbol TEXT, n INTEGER NOT NULL DEFAULT 0,
  first_ts TEXT, last_ts TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL,
  chrono_ok INTEGER, ohlc_ok INTEGER, dup_ts INTEGER, raw BLOB, fetched_at TEXT,
  PRIMARY KEY(symbol, series, date));
CREATE INDEX IF NOT EXISTS winners_sym ON winners(symbol);
"""


def connect(db_path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path), timeout=30, check_same_thread=False)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA synchronous=NORMAL')
    con.executescript(DDL)
    con.execute("INSERT OR IGNORE INTO meta VALUES('schema', ?)", (str(SCHEMA_VERSION),))
    con.commit()
    return con


def num(v):
    s = str(v if v is not None else '').strip().replace(',', '')
    if s in ('', '-', 'NA', 'nan'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def nse_date_iso(s):
    s = str(s or '').strip()
    p = s.split('-')
    if len(p) == 3 and p[1][:3].lower() in MONTHS:
        return '%s-%02d-%02d' % (p[2], MONTHS[p[1][:3].lower()], int(p[0]))
    return None


# ── bhavcopy: calendar, rows, winners ────────────────────────────────────────────────────────────
def http_get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Encoding': 'gzip', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
        return r.status, body


def parse_bhav(raw):
    """Rows of a sec_bhavdata_full file. Headers and cells carry stray spaces; both are stripped."""
    text = raw.decode('utf-8-sig', errors='replace')
    rd = csv.reader(io.StringIO(text))
    head = None
    out = []
    for row in rd:
        cells = [c.strip() for c in row]
        if head is None:
            head = [h.upper() for h in cells]
            continue
        if not any(cells):
            continue
        out.append(dict(zip(head, cells)))
    return out


def bhav_file_date(rows):
    ds = {nse_date_iso(r.get('DATE1')) for r in rows}
    ds.discard(None)
    return ds.pop() if len(ds) == 1 else None


def store_bhav(con, iso, raw, source):
    rows = parse_bhav(raw)
    fd = bhav_file_date(rows)
    if fd and fd != iso:
        raise ValueError('bhavcopy for %s says DATE1=%s' % (iso, fd))
    con.execute('DELETE FROM bhav WHERE date=?', (iso,))
    con.executemany('INSERT OR REPLACE INTO bhav VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [(
        iso, r.get('SYMBOL', ''), r.get('SERIES', ''), num(r.get('PREV_CLOSE')), num(r.get('OPEN_PRICE')),
        num(r.get('HIGH_PRICE')), num(r.get('LOW_PRICE')), num(r.get('LAST_PRICE')), num(r.get('CLOSE_PRICE')),
        num(r.get('AVG_PRICE')), num(r.get('TTL_TRD_QNTY')), num(r.get('TURNOVER_LACS')), num(r.get('NO_OF_TRADES')),
        num(r.get('DELIV_QTY')), num(r.get('DELIV_PER'))) for r in rows if r.get('SYMBOL')])
    con.execute('INSERT OR REPLACE INTO bhav_files VALUES(?,?,?,?)', (iso, source, zlib.compress(raw, 6), len(rows)))
    con.execute("INSERT OR REPLACE INTO calendar VALUES(?, 'session', ?, ?)", (iso, source, now_iso()))
    return len(rows)


def now_iso():
    return dt.datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')


def local_bhav_files(folder):
    """sec_bhavdata_full_*.csv in a folder, also inside .zip files (e.g. NSE daily reports zips)."""
    found = {}
    if not folder:
        return found
    for p in Path(folder).expanduser().rglob('*'):
        name = p.name.lower()
        try:
            if name.startswith('sec_bhavdata_full_') and name.endswith('.csv'):
                found.setdefault(ddmmyyyy_to_iso(name[18:26]), ('file:' + p.name, p.read_bytes()))
            elif name.endswith('.zip'):
                with zipfile.ZipFile(p) as z:
                    for n in z.namelist():
                        b = Path(n).name.lower()
                        if b.startswith('sec_bhavdata_full_') and b.endswith('.csv'):
                            found.setdefault(ddmmyyyy_to_iso(b[18:26]), ('zip:' + p.name, z.read(n)))
        except (OSError, zipfile.BadZipFile, ValueError):
            continue
    found.pop(None, None)
    return found


def ddmmyyyy_to_iso(s):
    try:
        return dt.date(int(s[4:8]), int(s[2:4]), int(s[0:2])).isoformat()
    except ValueError:
        return None


def sync_bhav(con, start, end, job, local_dir=None, refresh_none=False):
    """Probe every calendar date in [start, end]. Weekends are probed too: NSE has held special
    weekend sessions, and a session is defined by NSE publishing a bhavcopy, nothing else."""
    local = local_bhav_files(local_dir)
    have = dict(con.execute('SELECT date, status FROM calendar WHERE date BETWEEN ? AND ?', (start.isoformat(), end.isoformat())))
    today = dt.datetime.now(IST).date()
    days = [start + dt.timedelta(d) for d in range((end - start).days + 1)]
    job.set(stage='bhav', total=len(days), done=0)
    for i, d in enumerate(days):
        if job.stop_requested:
            return
        iso = d.isoformat()
        job.set(done=i, current=iso)
        if have.get(iso) == 'session':
            continue
        if have.get(iso) == 'none' and not refresh_none and d < today - dt.timedelta(days=3):
            continue
        if iso in local:
            src, raw = local[iso]
            store_bhav(con, iso, raw, src)
            con.commit()
            continue
        url = BHAV_URL.format(d=d.strftime('%d%m%Y'))
        for attempt in range(4):
            try:
                st, raw = http_get(url)
                if raw[:200].lower().find(b'symbol') < 0:
                    raise ValueError('not a bhavcopy (%d bytes)' % len(raw))
                n = store_bhav(con, iso, raw, 'nse')
                con.commit()
                log('bhav', iso, n, 'rows')
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    # Today's file appears in the evening; never mark today or a recent date closed.
                    if d < today - dt.timedelta(days=3):
                        con.execute("INSERT OR REPLACE INTO calendar VALUES(?, 'none', 'nse-404', ?)", (iso, now_iso()))
                        con.commit()
                    break
                job.note('bhav %s: HTTP %s (attempt %d)' % (iso, e.code, attempt + 1))
            except Exception as e:  # network trouble: retry, then leave the date unprobed
                job.note('bhav %s: %s (attempt %d)' % (iso, e, attempt + 1))
            time.sleep(2 ** attempt)
        time.sleep(BHAV_PAUSE)
    job.set(done=len(days))


def sessions(con):
    return [r[0] for r in con.execute("SELECT date FROM calendar WHERE status='session' ORDER BY date")]


def rank_rows(rows):
    """(gain %, symbol, series) best first. Gain is computed from NSE's prices at full precision."""
    return sorted((((c - p) / p * 100.0, sym, ser) for sym, ser, p, c in rows), key=lambda x: (-x[0], x[1], x[2]))


def compute_winners(con, start_iso, end_iso, series):
    """Top 30 per session by NSE's end-of-day gain. Ranking is gain desc, then symbol, then series,
    so it is deterministic; a tie straddling rank 30 is flagged, never silently resolved away."""
    cal = sessions(con)
    idx = {d: i for i, d in enumerate(cal)}
    ph = ','.join('?' * len(series))
    con.execute('DELETE FROM winners WHERE date BETWEEN ? AND ?', (start_iso, end_iso))
    made = 0
    for d in cal:
        if d < start_iso or d > end_iso:
            continue
        rows = con.execute('SELECT symbol, series, prev_close, close FROM bhav WHERE date=? AND series IN (%s) '
                           'AND prev_close>0 AND close>0' % ph, (d, *series)).fetchall()
        ranked = rank_rows(rows)
        if not ranked:
            continue
        cut = ranked[min(TOP_N, len(ranked)) - 1][0]
        tie = len(ranked) > TOP_N and ranked[TOP_N][0] == cut
        i = idx[d]
        p1 = cal[i - 1] if i >= 1 else None
        p2 = cal[i - 2] if i >= 2 else None
        for rank, (g, sym, ser) in enumerate(ranked[:TOP_N], 1):
            con.execute('INSERT INTO winners VALUES(?,?,?,?,?,?,?,?,?)',
                        (d, rank, sym, ser, g, len(ranked), int(tie and g == cut), p1, p2))
            made += 1
    con.commit()
    return made


# ── Kite ─────────────────────────────────────────────────────────────────────────────────────────
class Kite:
    def __init__(self, api_key, access_token):
        self.api_key, self.access_token = api_key, access_token
        self._last = 0.0

    def get(self, path, timeout=30):
        wait = KITE_MIN_INTERVAL - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()
        return http_get(KITE_ROOT + path, {'X-Kite-Version': '3',
                                           'Authorization': 'token %s:%s' % (self.api_key, self.access_token)}, timeout)

    def instruments(self):
        st, raw = self.get('/instruments/NSE', 60)
        out = {}
        for r in csv.DictReader(io.StringIO(raw.decode('utf-8', errors='replace'))):
            if r.get('segment') == 'NSE' and r.get('instrument_type') == 'EQ':
                out[r['tradingsymbol']] = int(r['instrument_token'])
        return out

    def minute(self, token, d_from, d_to):
        q = urllib.parse.urlencode({'from': d_from + ' 00:00:00', 'to': d_to + ' 23:59:59', 'oi': 0})
        st, raw = self.get('/instruments/historical/%d/minute?%s' % (token, q), 60)
        j = json.loads(raw)
        if j.get('status') != 'success':
            raise RuntimeError(j.get('message') or 'Kite error')
        return j['data']['candles']


def helper_instruments():
    """Fallback: the trading helper's own 'Kite Instruments.csv' (Symbol, Token). Read only."""
    try:
        st, raw = http_get(HELPER + '/api/inputs/file?name=' + urllib.parse.quote('Kite Instruments.csv'), timeout=15)
        out = {}
        for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig', errors='replace'))):
            s, t = (r.get('Symbol') or '').strip(), (r.get('Token') or '').strip()
            if s and t.isdigit():
                out[s] = int(t)
        return out
    except Exception:
        return {}


def kite_symbol(symbol, series):
    return symbol if series == 'EQ' else '%s-%s' % (symbol, series)


def session_summary(rows, date):
    """Facts read off the stored candles - counts, first/last stamps, extremes, integrity checks.
    Nothing is altered: the raw array is stored as received."""
    ts = [r[0] for r in rows]
    chrono = all(ts[i] < ts[i + 1] for i in range(len(ts) - 1)) and all(t[:10] == date for t in ts)
    ohlc = all(r[3] <= min(r[1], r[4]) and r[2] >= max(r[1], r[4]) for r in rows)
    return dict(n=len(rows), first_ts=ts[0] if ts else None, last_ts=ts[-1] if ts else None,
                open=rows[0][1] if rows else None, high=max(r[2] for r in rows) if rows else None,
                low=min(r[3] for r in rows) if rows else None, close=rows[-1][4] if rows else None,
                volume=sum((r[5] or 0) for r in rows) if rows else 0,
                chrono_ok=int(chrono), ohlc_ok=int(ohlc), dup_ts=len(ts) - len(set(ts)))


def store_session(con, symbol, series, date, status, token, tsym, rows):
    s = session_summary(rows, date) if rows else dict(n=0, first_ts=None, last_ts=None, open=None, high=None,
                                                    low=None, close=None, volume=0, chrono_ok=None, ohlc_ok=None, dup_ts=0)
    raw = zlib.compress(json.dumps(rows, separators=(',', ':')).encode(), 6) if rows else None
    con.execute('INSERT OR REPLACE INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (symbol, series, date, status, token, tsym, s['n'], s['first_ts'], s['last_ts'], s['open'], s['high'],
                 s['low'], s['close'], s['volume'], s['chrono_ok'], s['ohlc_ok'], s['dup_ts'], raw, now_iso()))


def candle_jobs(con, recheck_no_token=True):
    """Every (symbol, series) with the dates it needs and does not yet have, grouped into requests
    no wider than Kite allows. Adjacent windows of the same stock share one request."""
    need = {}
    for d, sym, ser, p1, p2 in con.execute('SELECT date, symbol, series, prior1, prior2 FROM winners'):
        for x in (p2, p1, d):
            if x:
                need.setdefault((sym, ser), set()).add(x)
    # ok/empty are final; no_token is re-checked each run (costs no request while still absent).
    final = "('ok','empty')" if recheck_no_token else "('ok','empty','no_token')"
    have = set(con.execute("SELECT symbol, series, date FROM candles WHERE status IN %s" % final))
    jobs = []
    for (sym, ser), dates in need.items():
        todo = sorted(x for x in dates if (sym, ser, x) not in have)
        group = []
        for x in todo:
            if group and ((dt.date.fromisoformat(x) - dt.date.fromisoformat(group[0])).days >= KITE_MAX_SPAN_DAYS
                          or (dt.date.fromisoformat(x) - dt.date.fromisoformat(group[-1])).days > 7):
                jobs.append((sym, ser, group))
                group = []
            group.append(x)
        if group:
            jobs.append((sym, ser, group))
    jobs.sort(key=lambda j: (j[2][0], j[0]))
    return jobs


def sync_candles(con, kite, job):
    jobs = candle_jobs(con)
    job.set(stage='candles', total=len(jobs), done=0)
    if not jobs:
        return
    tokens = {}
    try:
        tokens = kite.instruments()
        job.note('instruments: %d NSE equity tokens from Kite' % len(tokens))
    except Exception as e:
        job.note('Kite instruments failed (%s); trying the helper file' % e)
    if not tokens:
        tokens = helper_instruments()
        job.note('instruments: %d tokens from helper Kite Instruments.csv' % len(tokens))
    if not tokens:
        raise RuntimeError('No instrument tokens: Kite /instruments and the helper file both failed')
    for i, (sym, ser, dates) in enumerate(jobs):
        if job.stop_requested:
            return
        job.set(done=i, current='%s %s..%s' % (sym, dates[0], dates[-1]))
        tsym = kite_symbol(sym, ser)
        token = tokens.get(tsym)
        if not token:
            for x in dates:
                store_session(con, sym, ser, x, 'no_token', None, tsym, [])
            con.commit()
            continue
        rows = None
        for attempt in range(5):
            try:
                rows = kite.minute(token, dates[0], dates[-1])
                break
            except urllib.error.HTTPError as e:
                body = e.read()[:300].decode('utf-8', 'replace')
                if e.code in (401, 403):
                    raise RuntimeError('Kite rejected the access token (HTTP %d) - paste a fresh one. %s' % (e.code, body))
                if e.code == 400:
                    job.note('%s: Kite 400 %s' % (tsym, body))
                    break
                time.sleep(1.5 * (attempt + 1))
            except Exception as e:
                job.note('%s: %s (attempt %d)' % (tsym, e, attempt + 1))
                time.sleep(2 * (attempt + 1))
        if rows is None:
            continue                                   # left unstored, so a resume retries it
        by_date = {}
        for r in rows:
            by_date.setdefault(str(r[0])[:10], []).append(r)
        for x in dates:
            got = by_date.get(x, [])
            store_session(con, sym, ser, x, 'ok' if got else 'empty', token, tsym, got)
        con.commit()
        job.counts['requests'] = job.counts.get('requests', 0) + 1
    job.set(done=len(jobs))


# ── job runner (one at a time) ───────────────────────────────────────────────────────────────────
class Job:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = dict(running=False, stage=None, total=0, done=0, current=None, error=None,
                          started_at=None, finished_at=None, notes=[])
        self.counts = {}
        self.stop_requested = False

    def set(self, **kw):
        with self.lock:
            self.state.update(kw)

    def note(self, msg):
        log(msg)
        with self.lock:
            self.state['notes'] = (self.state['notes'] + [now_iso()[11:] + ' ' + msg])[-40:]

    def snapshot(self):
        with self.lock:
            return dict(self.state, counts=dict(self.counts))


def window(args):
    """Calendar dates to probe. Without --from: the year before --to (default today) plus a margin
    so the first winners have their two prior sessions."""
    end = dt.date.fromisoformat(args.to) if args.to else dt.datetime.now(IST).date()
    start = dt.date.fromisoformat(args.from_) if args.from_ else end - dt.timedelta(days=366)
    return start - dt.timedelta(days=12), start, end


def run_collect(con, args, job, kite=None, stage='all'):
    job.stop_requested = False
    job.set(running=True, error=None, started_at=now_iso(), finished_at=None, notes=[])
    job.counts = {}
    try:
        probe_from, start, end = window(args)
        if stage in ('all', 'bhav'):
            sync_bhav(con, probe_from, end, job, args.bhav_dir)
            cal = [d for d in sessions(con) if d <= end.isoformat()]
            if not cal:
                raise RuntimeError('no bhavcopy found in the window - NSE unreachable? try --bhav-dir')
            # "The most recent full year of completed sessions": every session within the year that
            # ends at the latest session NSE has published.
            last = cal[-1]
            first = args.from_ or (dt.date.fromisoformat(last) - dt.timedelta(days=365) + dt.timedelta(days=1)).isoformat()
            con.execute('DELETE FROM winners WHERE date < ? OR date > ?', (first, last))
            n = compute_winners(con, first, last, args.series)
            con.execute("INSERT OR REPLACE INTO meta VALUES('window', ?)", (json.dumps(
                {'first': first, 'last': last, 'series': list(args.series), 'top_n': TOP_N}),))
            con.commit()
            job.note('winners: %d instances on %d sessions, %s to %s' % (
                n, con.execute('SELECT COUNT(DISTINCT date) FROM winners').fetchone()[0], first, last))
        if stage in ('all', 'candles') and not job.stop_requested:
            if not kite:
                raise RuntimeError('Kite credentials are needed for candles (api key + access token)')
            sync_candles(con, kite, job)
    except Exception as e:
        job.set(error=str(e))
        log('ERROR', e)
        traceback.print_exc()
    finally:
        job.set(running=False, finished_at=now_iso(), current=None)


# ── read model for the Study tab ─────────────────────────────────────────────────────────────────
def winners_payload(con):
    meta = dict(con.execute('SELECT key, value FROM meta'))
    cols = ['date', 'rank', 'symbol', 'series', 'gain_pct', 'universe', 'tie', 'prior1', 'prior2',
            'prev_close', 'open', 'high', 'low', 'last', 'close', 'avg', 'qty', 'turnover_lacs', 'trades', 'deliv_per']
    rows = con.execute(
        'SELECT w.date, w.rank, w.symbol, w.series, w.gain_pct, w.universe, w.tie_at_cutoff, w.prior1, w.prior2, '
        'b.prev_close, b.open, b.high, b.low, b.last, b.close, b.avg, b.qty, b.turnover_lacs, b.trades, b.deliv_per '
        'FROM winners w LEFT JOIN bhav b ON b.date=w.date AND b.symbol=w.symbol AND b.series=w.series '
        'ORDER BY w.date, w.rank').fetchall()
    sess = {}
    for r in con.execute('SELECT symbol, series, date, status, n, first_ts, last_ts, open, high, low, close, volume, '
                         'chrono_ok, ohlc_ok, dup_ts FROM candles'):
        sess[(r[0], r[1], r[2])] = list(r[3:])
    scols = ['status', 'n', 'first_ts', 'last_ts', 'open', 'high', 'low', 'close', 'volume', 'chrono_ok', 'ohlc_ok', 'dup_ts']
    out = []
    for r in rows:
        d, sym, ser, p1, p2 = r[0], r[2], r[3], r[7], r[8]
        out.append(list(r) + [sess.get((sym, ser, x)) if x else None for x in (p2, p1, d)])
    return {'ok': True, 'cols': cols + ['s2', 's1', 's0'], 'session_cols': scols, 'rows': out,
            'window': json.loads(meta.get('window', '{}')), 'sessions': sessions(con)}


def candles_payload(con, symbol, series, dates):
    out = []
    for d in dates:
        r = con.execute('SELECT status, raw, token, tradingsymbol FROM candles WHERE symbol=? AND series=? AND date=?',
                        (symbol, series, d)).fetchone()
        if not r:
            out.append({'date': d, 'status': 'not_fetched', 'candles': []})
        else:
            out.append({'date': d, 'status': r[0], 'token': r[2], 'tradingsymbol': r[3],
                        'candles': json.loads(zlib.decompress(r[1])) if r[1] else []})
    return {'ok': True, 'symbol': symbol, 'series': series, 'sessions': out}


def status_payload(con, job, creds):
    q = lambda s, *a: con.execute(s, a).fetchone()[0]
    st = dict(con.execute('SELECT status, COUNT(*) FROM candles GROUP BY status'))
    return {'ok': True, 'version': SCHEMA_VERSION, 'db': str(con.execute('PRAGMA database_list').fetchone()[2]),
            'calendar_sessions': q("SELECT COUNT(*) FROM calendar WHERE status='session'"),
            'calendar_first': q("SELECT MIN(date) FROM calendar WHERE status='session'"),
            'calendar_last': q("SELECT MAX(date) FROM calendar WHERE status='session'"),
            'winner_days': q('SELECT COUNT(DISTINCT date) FROM winners'), 'instances': q('SELECT COUNT(*) FROM winners'),
            'candle_sessions': st, 'pending_requests': len(candle_jobs(con, recheck_no_token=False)),
            'has_credentials': bool(creds.get('api_key') and creds.get('access_token')),
            'job': job.snapshot()}


# ── verification ─────────────────────────────────────────────────────────────────────────────────
def verify(con, series):
    """Re-derive what was stored and report every disagreement. Read-only."""
    rep = {'gain_mismatch': 0, 'rank_mismatch': 0, 'winners': 0, 'days': 0}
    for d in sorted({r[0] for r in con.execute('SELECT DISTINCT date FROM winners')}):
        rep['days'] += 1
        ph = ','.join('?' * len(series))
        rows = con.execute('SELECT symbol, series, prev_close, close FROM bhav WHERE date=? AND series IN (%s) AND prev_close>0 AND close>0' % ph, (d, *series)).fetchall()
        # Independent arithmetic (ratio - 1) rather than the collector's (diff / prev).
        exp = {(sym, ser): (float(c) / float(p) - 1.0) * 100.0 for sym, ser, p, c in rows}
        got = con.execute('SELECT rank, symbol, series, gain_pct FROM winners WHERE date=? ORDER BY rank', (d,)).fetchall()
        floor = min((g for _, _, _, g in got), default=None)
        prev = None
        for rank, sym, ser, g in got:
            rep['winners'] += 1
            e = exp.get((sym, ser))
            if e is None or abs(g - e) > 1e-7:
                rep['gain_mismatch'] += 1
            if prev is not None and g > prev + 1e-12:
                rep['rank_mismatch'] += 1
            prev = g
        # nothing outside the 30 may beat the 30th
        names = {(sym, ser) for _, sym, ser, _ in got}
        if floor is not None and any(v > floor + 1e-7 for k, v in exp.items() if k not in names):
            rep['rank_mismatch'] += 1
    c = con.execute("SELECT COUNT(*), SUM(chrono_ok=0), SUM(ohlc_ok=0), SUM(dup_ts>0) FROM candles WHERE status='ok'").fetchone()
    rep.update(sessions_ok=c[0], chronology_violations=c[1] or 0, ohlc_violations=c[2] or 0, duplicate_stamps=c[3] or 0)
    rep['by_status'] = dict(con.execute('SELECT status, COUNT(*) FROM candles GROUP BY status'))
    # Winning-day candles against NSE's own day: the candle high/low should equal bhav high/low.
    hl = con.execute("SELECT COUNT(*), SUM(ABS(c.high-b.high)<=0.0001), SUM(ABS(c.low-b.low)<=0.0001) FROM winners w "
                     "JOIN candles c ON c.symbol=w.symbol AND c.series=w.series AND c.date=w.date AND c.status='ok' "
                     "JOIN bhav b ON b.symbol=w.symbol AND b.series=w.series AND b.date=w.date").fetchone()
    rep.update(winning_day_sessions=hl[0], high_matches_bhav=hl[1] or 0, low_matches_bhav=hl[2] or 0)
    rep['instances_complete'] = con.execute(
        "SELECT COUNT(*) FROM winners w WHERE "
        "(SELECT COUNT(*) FROM candles c WHERE c.symbol=w.symbol AND c.series=w.series AND c.status='ok' "
        " AND c.date IN (w.date, w.prior1, w.prior2))=3").fetchone()[0]
    rep['days_short'] = con.execute('SELECT COUNT(*) FROM (SELECT date FROM winners GROUP BY date HAVING COUNT(*) < ?)', (TOP_N,)).fetchone()[0]
    return rep


# ── HTTP server ──────────────────────────────────────────────────────────────────────────────────
def make_handler(db_path, args, job, creds):
    local = threading.local()

    def db():
        if not getattr(local, 'con', None):
            local.con = connect(db_path)
        return local.con

    class H(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *a):
            pass

        def cors(self):
            origin = self.headers.get('Origin') or '*'
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            # Chrome's Private Network Access: a public page may reach localhost only if it says so.
            self.send_header('Access-Control-Allow-Private-Network', 'true')

        def reply(self, obj, code=200):
            body = json.dumps(obj, separators=(',', ':')).encode()
            gz = 'gzip' in (self.headers.get('Accept-Encoding') or '') and len(body) > 2048
            if gz:
                body = gzip.compress(body, 5)
            self.send_response(code)
            self.cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            if gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            try:
                if u.path == '/study/status':
                    return self.reply(status_payload(db(), job, creds))
                if u.path == '/study/winners':
                    return self.reply(winners_payload(db()))
                if u.path == '/study/candles':
                    dates = [x for x in q.get('dates', '').split(',') if x]
                    return self.reply(candles_payload(db(), q.get('symbol', ''), q.get('series', 'EQ'), dates[:10]))
                if u.path == '/study/verify':
                    return self.reply({'ok': True, 'report': verify(db(), args.series)})
                return self.reply({'ok': False, 'why': 'unknown path'}, 404)
            except Exception as e:
                traceback.print_exc()
                return self.reply({'ok': False, 'why': str(e)}, 500)

        def do_POST(self):
            u = urllib.parse.urlparse(self.path)
            n = int(self.headers.get('Content-Length') or 0)
            try:
                body = json.loads(self.rfile.read(n) or b'{}')
            except ValueError:
                body = {}
            if u.path == '/study/credentials':
                for k in ('api_key', 'access_token'):
                    if body.get(k):
                        creds[k] = str(body[k]).strip()
                return self.reply({'ok': True, 'has_credentials': bool(creds.get('api_key') and creds.get('access_token'))})
            if u.path == '/study/collect':
                if job.snapshot()['running']:
                    return self.reply({'ok': False, 'why': 'a collection is already running'}, 409)
                stage = body.get('stage') or 'all'
                kite = Kite(creds['api_key'], creds['access_token']) if creds.get('api_key') and creds.get('access_token') else None
                threading.Thread(target=run_collect, args=(connect(db_path), args, job, kite, stage), daemon=True).start()
                return self.reply({'ok': True})
            if u.path == '/study/stop':
                job.stop_requested = True
                return self.reply({'ok': True})
            return self.reply({'ok': False, 'why': 'unknown path'}, 404)

    return H


def load_creds(args):
    c = {'api_key': args.api_key or os.environ.get('KITE_API_KEY'),
         'access_token': args.access_token or os.environ.get('KITE_ACCESS_TOKEN')}
    if args.token_file:
        try:
            j = json.loads(Path(args.token_file).expanduser().read_text())
            c['api_key'] = c['api_key'] or j.get('api_key') or j.get('apiKey')
            c['access_token'] = c['access_token'] or j.get('access_token') or j.get('accessToken')
        except (OSError, ValueError) as e:
            log('token file unreadable:', e)
    return c


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['serve', 'collect', 'verify'])
    ap.add_argument('--dir', default=str(DEFAULT_DIR), help='data folder (default %(default)s)')
    ap.add_argument('--port', type=int, default=DEFAULT_PORT)
    ap.add_argument('--from', dest='from_', help='first winning date YYYY-MM-DD (default: one year before the latest session)')
    ap.add_argument('--to', help='last calendar date to consider (default today)')
    ap.add_argument('--series', default=','.join(DEFAULT_SERIES), help='bhavcopy series in the universe (default %(default)s)')
    ap.add_argument('--stage', choices=['all', 'bhav', 'candles'], default='all')
    ap.add_argument('--bhav-dir', help='folder with sec_bhavdata_full_*.csv files or NSE report zips, used before downloading')
    ap.add_argument('--api-key')
    ap.add_argument('--access-token')
    ap.add_argument('--token-file', help='JSON file holding api_key and access_token')
    ap.add_argument('--kite-root', help=argparse.SUPPRESS)
    ap.add_argument('--bhav-url', help=argparse.SUPPRESS)
    ap.add_argument('--pace', type=float, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    args.series = tuple(s.strip().upper() for s in args.series.split(',') if s.strip())
    global KITE_ROOT, BHAV_URL, KITE_MIN_INTERVAL, BHAV_PAUSE
    if args.pace is not None:
        KITE_MIN_INTERVAL = BHAV_PAUSE = args.pace
    if args.kite_root:
        KITE_ROOT = args.kite_root
    if args.bhav_url:
        BHAV_URL = args.bhav_url
    db_path = Path(args.dir).expanduser() / 'study.db'
    con = connect(db_path)
    creds = load_creds(args)
    job = Job()
    if args.command == 'verify':
        print(json.dumps(verify(con, args.series), indent=2))
        return 0
    if args.command == 'collect':
        kite = Kite(creds['api_key'], creds['access_token']) if creds.get('api_key') and creds.get('access_token') else None
        run_collect(con, args, job, kite, args.stage)
        s = job.snapshot()
        print(json.dumps({k: s[k] for k in ('error', 'stage', 'done', 'total')}, indent=2))
        return 1 if s['error'] else 0
    srv = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(db_path, args, job, creds))
    log('Rocket Scanner Study server on http://localhost:%d  (data: %s)' % (args.port, db_path))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
