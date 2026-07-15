"""Automate the existing TradingView -> Rocket Scanner browser workflow.

This utility deliberately uses the visible browser UI and a dedicated persistent
Playwright profile. It never handles credentials, bypasses security, or validates
the downloaded CSV schema.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import re
import random
import shutil
import signal
import socket
import subprocess
import sys
import time
from dataclasses import replace
from dataclasses import dataclass
from datetime import datetime, timedelta, time as clock_time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable, Optional
from zoneinfo import ZoneInfo

try:
    from playwright.async_api import BrowserContext, Download, Page, TimeoutError as PlaywrightTimeoutError, async_playwright
except ModuleNotFoundError:  # Keep --help and config checks usable before install.
    BrowserContext = Any  # type: ignore[assignment,misc]
    Download = Any  # type: ignore[assignment,misc]
    Page = Any  # type: ignore[assignment,misc]
    PlaywrightTimeoutError = TimeoutError  # type: ignore[assignment,misc]
    async_playwright = None  # type: ignore[assignment]


PROJECT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = PROJECT_DIR / "automation_config.json"
PROFILE_DIR = PROJECT_DIR / "browser_profile"
PAUSE_FILE = PROJECT_DIR / "automation_pause.txt"
STOP_FILE = PROJECT_DIR / "automation_stop.txt"
LOGIN_FILE = PROJECT_DIR / "automation_login.txt"
LOCK_FILE = PROJECT_DIR / "automation.lock"
LOG_DIR = PROJECT_DIR / "logs"
SCREENSHOT_DIR = PROJECT_DIR / "failure_screenshots"
PAGE_DIR = PROJECT_DIR / "failure_pages"

# TradingView labels change occasionally. Keep all UI alternatives here so the
# interaction code remains stable and the selectors are easy to update.
TV_MENU_CANDIDATES = (
    ("role", "button", "ALL NSE"),
    ("text", "ALL NSE", ""),
    ("role", "button", "Export"),
    ("role", "button", "Download"),
    ("text", "Export", ""),
    ("text", "Download", ""),
)
TV_EXPORT_CANDIDATES = (
    ("text", "Download results as CSV", ""),
    ("text", "Export chart data", ""),
    ("text", "Download CSV", ""),
    ("text", "Download CSV file", ""),
    ("text", "Export screen results", ""),
    ("text", "CSV", ""),
    ("role", "menuitem", "CSV"),
)
ROCKET_LOAD_SELECTOR = "#loadFilesBtn"
ROCKET_LOADING_SELECTOR = "#ldSt"
ROCKET_MESSAGE_SELECTOR = "#ldMsg"
ROCKET_VERSION_SELECTOR = "#verLabel"
ROCKET_CHECKLIST_SELECTOR = "#fileLoadChecklist"
MANUAL_AUTH_MARKERS = (
    "captcha",
    "verify you are human",
    "two-factor",
    "two factor",
    "log in",
    "sign in",
    "sign in to continue",
    "session expired",
    "select the rocket scanner folder",
    "connect google drive",
)

AUTOMATION_STATUS = {
    "state": "idle",
    "progress": 0,
    "message": "Automation is idle",
    "error": "",
}
STATUS_SERVER: Any = None


def set_automation_status(state: str, progress: int, message: str, error: str = "") -> None:
    AUTOMATION_STATUS.update({"state": state, "progress": max(0, min(100, progress)), "message": message, "error": error})


async def start_status_server() -> None:
    global STATUS_SERVER

    async def handle_status(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            with contextlib.suppress(asyncio.IncompleteReadError, asyncio.TimeoutError):
                await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=2)
            body = json.dumps(AUTOMATION_STATUS).encode("utf-8")
            headers = (
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                b"Access-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n"
                + f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode("ascii")
            )
            writer.write(headers + body)
            await writer.drain()
        finally:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()

    STATUS_SERVER = await asyncio.start_server(handle_status, "127.0.0.1", 8765)


async def stop_status_server() -> None:
    global STATUS_SERVER
    if STATUS_SERVER:
        STATUS_SERVER.close()
        await STATUS_SERVER.wait_closed()
        STATUS_SERVER = None


@dataclass(frozen=True)
class Config:
    tradingview_url: str
    rocket_scanner_url: str
    scanner_uploads_folder: Path
    output_filename: str
    minimum_interval_minutes: int
    maximum_interval_minutes: int
    automation_start: clock_time
    automation_end: clock_time
    timezone: str
    run_final_cycle: bool
    final_cycle_time: clock_time
    headless: bool
    tradingview_page_timeout_seconds: int
    download_timeout_seconds: int
    rocket_processing_timeout_seconds: int
    retry_attempts: int
    retry_delay_seconds: int
    final_cycle_proximity_minutes: int = 2

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def output_path(self) -> Path:
        return self.scanner_uploads_folder / self.output_filename


class CycleFailure(RuntimeError):
    """A cycle failed at a named, user-actionable stage."""

    def __init__(self, step: str, message: str):
        super().__init__(message)
        self.step = step


class AutomationStopRequested(RuntimeError):
    """Raised when the owner requests a clean stop during an active cycle."""


class TradingViewLoginRequired(RuntimeError):
    """Raised when hidden automation needs a visible TradingView sign-in."""


def parse_clock(value: Any, field: str) -> clock_time:
    try:
        hour, minute = str(value).split(":", 1)
        result = clock_time(int(hour), int(minute))
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be HH:MM") from None
    return result


def load_config(path: Path = CONFIG_PATH) -> Config:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"Missing configuration: {path}") from None
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from None

    def required(name: str) -> Any:
        if name not in raw:
            raise ValueError(f"Configuration is missing {name}")
        return raw[name]

    minimum = int(required("minimum_interval_minutes"))
    maximum = int(required("maximum_interval_minutes"))
    if minimum <= 0 or maximum <= 0 or maximum < minimum:
        raise ValueError("Interval values must be positive and maximum >= minimum")
    retries = int(required("retry_attempts"))
    if retries < 0:
        raise ValueError("retry_attempts must be zero or greater")
    folder = Path(str(required("scanner_uploads_folder"))).expanduser()
    if not folder.is_absolute():
        raise ValueError("scanner_uploads_folder must be an absolute Windows path")
    if not str(required("output_filename")).strip():
        raise ValueError("output_filename cannot be empty")
    start_time = parse_clock(required("automation_start"), "automation_start")
    end_time = parse_clock(required("automation_end"), "automation_end")
    if end_time < start_time:
        raise ValueError("automation_end must be at or after automation_start")
    numeric_limits = {
        "tradingview_page_timeout_seconds": int(required("tradingview_page_timeout_seconds")),
        "download_timeout_seconds": int(required("download_timeout_seconds")),
        "rocket_processing_timeout_seconds": int(required("rocket_processing_timeout_seconds")),
        "retry_delay_seconds": int(required("retry_delay_seconds")),
        "final_cycle_proximity_minutes": int(raw.get("final_cycle_proximity_minutes", 2)),
    }
    if any(value <= 0 for value in numeric_limits.values()):
        raise ValueError("Timeout, retry delay, and final-cycle proximity values must be positive")
    return Config(
        tradingview_url=str(required("tradingview_url")).strip(),
        rocket_scanner_url=str(required("rocket_scanner_url")).strip(),
        scanner_uploads_folder=folder,
        output_filename=str(required("output_filename")).strip(),
        minimum_interval_minutes=minimum,
        maximum_interval_minutes=maximum,
        automation_start=start_time,
        automation_end=end_time,
        timezone=str(required("timezone")),
        run_final_cycle=bool(required("run_final_cycle")),
        final_cycle_time=parse_clock(required("final_cycle_time"), "final_cycle_time"),
        headless=bool(required("headless")),
        tradingview_page_timeout_seconds=numeric_limits["tradingview_page_timeout_seconds"],
        download_timeout_seconds=numeric_limits["download_timeout_seconds"],
        rocket_processing_timeout_seconds=numeric_limits["rocket_processing_timeout_seconds"],
        retry_attempts=retries,
        retry_delay_seconds=numeric_limits["retry_delay_seconds"],
        final_cycle_proximity_minutes=numeric_limits["final_cycle_proximity_minutes"],
    )


def configure_logging() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("tradingview_rocket_automation")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    file_handler = RotatingFileHandler(LOG_DIR / "automation.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    if sys.stdout is not None:
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(formatter)
        logger.addHandler(console)
    return logger


LOGGER = configure_logging()


def require_playwright() -> None:
    if async_playwright is None:
        raise RuntimeError("Playwright is not installed. Run: pip install -r requirements.txt && playwright install chromium")


def now_in(tz: ZoneInfo) -> datetime:
    return datetime.now(tz)


def display_time(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S %Z")


class SingleInstance:
    def __enter__(self) -> "SingleInstance":
        try:
            self.handle = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(self.handle, str(os.getpid()).encode("ascii"))
        except FileExistsError:
            pid = LOCK_FILE.read_text(encoding="ascii", errors="ignore").strip()
            try:
                alive = bool(pid) and os.name == "nt" and os.kill(int(pid), 0) is None
            except PermissionError:
                alive = True
            except (ValueError, OSError):
                alive = False
            if alive:
                raise RuntimeError(f"Another automation instance is already running (PID {pid}).")
            try:
                LOCK_FILE.unlink()
            except OSError as exc:
                raise RuntimeError("Automation is already starting or its lock file is still in use.") from exc
            self.handle = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(self.handle, str(os.getpid()).encode("ascii"))
        return self

    def __exit__(self, *_: Any) -> None:
        with contextlib.suppress(OSError):
            os.close(self.handle)
        with contextlib.suppress(OSError):
            LOCK_FILE.unlink()


def remove_stale_temporary_downloads(folder: Path, filename: str) -> None:
    source = Path(filename)
    for candidate in folder.glob(f"{source.stem}.new*"):
        if candidate.is_file():
            with contextlib.suppress(OSError):
                candidate.unlink()


def atomic_replace_download(download_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    os.replace(download_path, target_path)


async def candidate_locator(page: Page, candidate: tuple[str, str, str]):
    kind, first, second = candidate
    if kind == "role":
        return page.get_by_role(first, name=second, exact=False).first
    return page.get_by_text(first, exact=False).first


async def click_candidates(page: Page, candidates: Iterable[tuple[str, str, str]], timeout_ms: int) -> tuple[bool, str]:
    for candidate in candidates:
        locator = await candidate_locator(page, candidate)
        try:
            if await locator.is_visible() and await locator.is_enabled():
                await locator.click(timeout=timeout_ms)
                return True, f"{candidate[0]}:{candidate[1]}:{candidate[2]}"
        except (PlaywrightTimeoutError, Exception):
            continue
    return False, "none"


async def page_body(page: Page) -> str:
    with contextlib.suppress(Exception):
        return (await page.locator("body").inner_text(timeout=3000)).lower()
    return ""


async def wait_for_manual_browser_action(page: Page, reason: str, ready_markers: tuple[str, ...], timeout_seconds: int = 900) -> None:
    LOGGER.warning("Manual action required: %s", reason)
    LOGGER.warning("Complete it in the visible browser. Automation will resume when the page is usable.")
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        body = await page_body(page)
        if not any(marker in body for marker in MANUAL_AUTH_MARKERS):
            if not ready_markers or any(marker.lower() in body for marker in ready_markers):
                LOGGER.info("Manual action completed; resuming.")
                return
        await asyncio.sleep(5)
    raise CycleFailure("manual intervention", "Timed out waiting for the manual browser action")


async def ensure_tradingview_ready(page: Page, config: Config) -> None:
    await page.goto(config.tradingview_url, wait_until="domcontentloaded", timeout=config.tradingview_page_timeout_seconds * 1000)
    await page.wait_for_selector("body", state="attached", timeout=config.tradingview_page_timeout_seconds * 1000)
    body = ""
    for _ in range(10):
        await page.wait_for_timeout(1000)
        body = await page_body(page)
        if body.strip():
            break
    title = (await page.title()).lower()
    if "page not found" in title or "this isn't the page you're looking for" in body:
        raise TradingViewLoginRequired("TradingView login expired or the private screener is unavailable")
    if any(marker in body for marker in MANUAL_AUTH_MARKERS):
        if config.headless:
            raise TradingViewLoginRequired("TradingView requires a visible sign-in")
        await wait_for_manual_browser_action(page, "TradingView login, CAPTCHA, consent, or session renewal", ("screener",))
    if not body.strip():
        raise CycleFailure("TradingView page", "Screener page returned no visible body content")
    LOGGER.info("TradingView page opened")
    LOGGER.info("Screener ready")


async def download_tradingview_csv(page: Page, config: Config, cycle_id: str) -> None:
    folder = config.scanner_uploads_folder
    folder.mkdir(parents=True, exist_ok=True)
    remove_stale_temporary_downloads(folder, config.output_filename)
    output = Path(config.output_filename)
    temp_path = folder / f"{output.stem}.new{output.suffix}"
    with contextlib.suppress(FileNotFoundError):
        temp_path.unlink()

    opened, selector = await click_candidates(page, TV_MENU_CANDIDATES, config.tradingview_page_timeout_seconds * 1000)
    if not opened:
        await save_failure_evidence(page, cycle_id, "tradingview-menu")
        raise CycleFailure("TradingView menu", "No configured export/download menu selector was usable")
    LOGGER.info("Menu opened (%s)", selector)
    try:
        async with page.expect_download(timeout=config.download_timeout_seconds * 1000) as download_info:
            clicked, export_selector = await click_candidates(page, TV_EXPORT_CANDIDATES, config.download_timeout_seconds * 1000)
            if not clicked:
                raise CycleFailure("TradingView export", "No configured CSV export selector was usable")
            LOGGER.info("Export clicked (%s)", export_selector)
        download: Download = await download_info.value
        LOGGER.info("Download started")
        await download.save_as(str(temp_path))
        LOGGER.info("Download completed")
    except Exception:
        with contextlib.suppress(FileNotFoundError):
            temp_path.unlink()
        raise
    atomic_replace_download(temp_path, folder / config.output_filename)
    LOGGER.info("%s replaced", config.output_filename)


async def find_page(context: BrowserContext, configured_url: str, label: str) -> Page:
    pages = [page for page in context.pages if not page.is_closed()]
    for page in pages:
        if configured_url and configured_url.split("/", 3)[2:3] and configured_url.split("/", 3)[2] in page.url:
            return page
    page = pages[0] if pages else await context.new_page()
    await page.goto(configured_url, wait_until="domcontentloaded")
    LOGGER.info("Opened %s tab", label)
    return page


async def wait_for_rocket_processing(page: Page, config: Config, cycle_id: str) -> None:
    loading = page.locator(ROCKET_LOADING_SELECTOR)
    deadline = time.monotonic() + config.rocket_processing_timeout_seconds
    startup_deadline = min(deadline, time.monotonic() + 15)
    started = False
    while time.monotonic() < startup_deadline:
        if STOP_FILE.exists():
            raise AutomationStopRequested("Stop requested during Rocket Scanner startup")
        visible = await loading.is_visible()
        if visible:
            started = True
            break
        body = await page_body(page)
        if PAUSE_FILE.exists():
            set_automation_status("paused", 82, "Paused after current Rocket Scanner action")
        if any(marker in body for marker in ("reconnect drive", "connect google drive", "select the rocket scanner folder", "select the scanner uploads folder")):
            raise CycleFailure("Rocket Scanner Load Files", "Drive connection or Scanner Uploads permission is unavailable in the automation browser")
        await asyncio.sleep(0.5)
    if not started:
        body = await page_body(page)
        if "select the rocket scanner folder" in body or "connect google drive" in body:
            await wait_for_manual_browser_action(page, "Rocket Scanner folder permission or Drive reconnection", ("rocket scanner", "load files"))
            return await wait_for_rocket_processing(page, config, cycle_id)
        await save_failure_evidence(page, cycle_id, "rocket-load-not-started")
        raise CycleFailure("Rocket Scanner loading", "Load Files did not show the processing overlay")
    while time.monotonic() < deadline:
        if STOP_FILE.exists():
            raise AutomationStopRequested("Stop requested during Rocket Scanner processing")
        if PAUSE_FILE.exists():
            set_automation_status("paused", 82, "Paused after current Rocket Scanner action")
        else:
            set_automation_status("running", 90, "Rocket Scanner is processing files")
        if not await loading.is_visible():
            message = await page.locator(ROCKET_MESSAGE_SELECTOR).inner_text()
            LOGGER.info("Rocket Scanner processing completed: %s", message.strip())
            return
        await asyncio.sleep(1)
    await save_failure_evidence(page, cycle_id, "rocket-processing-timeout")
    raise CycleFailure("Rocket Scanner processing", "Processing overlay did not hide before timeout")


async def load_rocket_scanner(page: Page, config: Config, cycle_id: str) -> None:
    await page.goto(config.rocket_scanner_url, wait_until="domcontentloaded", timeout=config.tradingview_page_timeout_seconds * 1000)
    await page.wait_for_selector(ROCKET_LOAD_SELECTOR, timeout=config.tradingview_page_timeout_seconds * 1000)
    version = await page.locator(ROCKET_VERSION_SELECTOR).inner_text() if await page.locator(ROCKET_VERSION_SELECTOR).count() else "unknown"
    LOGGER.info("Rocket Scanner tab ready (%s)", version.strip())
    button = page.locator(ROCKET_LOAD_SELECTOR)
    if not await button.is_enabled():
        await wait_for_manual_browser_action(page, "Google Drive reconnection is required before Load Files", ("load files",))
        if not await button.is_enabled():
            raise CycleFailure("Rocket Scanner Load Files", "Load Files remains disabled")
    await button.click()
    LOGGER.info("Rocket Scanner Load Files clicked")
    await wait_for_rocket_processing(page, config, cycle_id)
    checklist = page.locator(ROCKET_CHECKLIST_SELECTOR)
    checklist_text = (await checklist.inner_text(timeout=5000)).lower() if await checklist.count() else ""
    if "all nse.csv" not in checklist_text or "loaded" not in checklist_text:
        raise CycleFailure("Rocket Scanner Load Files", "Load Files did not confirm ALL NSE.csv as loaded")


async def save_failure_evidence(page: Page, cycle_id: str, step: str) -> None:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = f"{stamp}_{cycle_id}_{step}"
    with contextlib.suppress(Exception):
        await page.screenshot(path=str(SCREENSHOT_DIR / f"{stem}.png"), full_page=True)
    if "selector" in step or "menu" in step or "load-not-started" in step:
        with contextlib.suppress(Exception):
            (PAGE_DIR / f"{stem}.html").write_text(await page.content(), encoding="utf-8")


async def retry_stage(name: str, operation: Callable[[], Awaitable[None]], config: Config, cycle_id: str) -> None:
    attempts = config.retry_attempts + 1
    for attempt in range(1, attempts + 1):
        try:
            await operation()
            return
        except Exception as exc:
            if isinstance(exc, TradingViewLoginRequired):
                raise
            if isinstance(exc, AutomationStopRequested):
                raise
            LOGGER.exception("Cycle %s failed at %s (attempt %s/%s): %s", cycle_id, name, attempt, attempts, exc)
            if attempt == attempts:
                raise CycleFailure(name, str(exc)) from exc
            await asyncio.sleep(config.retry_delay_seconds)


async def run_cycle(context: BrowserContext, config: Config, cycle_id: str) -> bool:
    if PAUSE_FILE.exists():
        LOGGER.info("Cycle %s paused: automation_pause.txt exists", cycle_id)
        return False
    tv_page: Optional[Page] = None
    try:
        set_automation_status("running", 5, "Opening TradingView")
        tv_page = await find_page(context, config.tradingview_url, "TradingView")
        set_automation_status("running", 20, "Waiting for TradingView screener")
        await retry_stage("TradingView export", lambda: export_cycle(tv_page, config, cycle_id), config, cycle_id)
        AUTOMATION_STATUS.update({"download_id": cycle_id, "downloaded_at": datetime.now().isoformat(timespec="seconds")})
        set_automation_status("downloaded", 70, "CSV ready for the visible Rocket Scanner page")
        LOGGER.info("Cycle %s download succeeded; visible Rocket Scanner refresh requested", cycle_id)
        return True
    except Exception as exc:
        if isinstance(exc, TradingViewLoginRequired):
            raise
        if isinstance(exc, AutomationStopRequested):
            set_automation_status("stopped", 0, "Automation stopped")
            LOGGER.info("Cycle %s stopped by user", cycle_id)
            return False
        set_automation_status("error", int(AUTOMATION_STATUS.get("progress", 0)), f"Automation failed: {exc}", str(exc))
        LOGGER.exception("Cycle %s failed: %s", cycle_id, exc)
        return False


async def export_cycle(page: Page, config: Config, cycle_id: str) -> None:
    await ensure_tradingview_ready(page, config)
    await download_tradingview_csv(page, config, cycle_id)


class BrowserSession:
    """A normal Chrome process connected to Playwright over local CDP."""

    def __init__(self, browser: Any, context: BrowserContext, process: subprocess.Popen[bytes] | None):
        self.browser = browser
        self.context = context
        self.process = process

    def __getattr__(self, name: str) -> Any:
        return getattr(self.context, name)

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            await self.browser.close()
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                await asyncio.to_thread(self.process.wait, 10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                await asyncio.to_thread(self.process.wait, 5)


def chrome_executable() -> Path:
    candidates = (
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError("Installed Google Chrome was not found")


def unused_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def existing_profile_session() -> tuple[int, bool] | None:
    """Return the CDP port and headed/headless state of automation Chrome, if any."""
    command = (
        "Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" "
        "| Where-Object { $_.CommandLine -like '*--user-data-dir=*browser_profile*' } "
        "| Select-Object -ExpandProperty CommandLine"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"--remote-debugging-port[= ](\d+)", result.stdout)
    if not match:
        return None
    return int(match.group(1)), "--headless" in result.stdout


def stop_existing_profile() -> None:
    command = (
        "Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" "
        "| Where-Object { $_.CommandLine -like '*--user-data-dir=*browser_profile*' } "
        "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    with contextlib.suppress(OSError, subprocess.SubprocessError):
        subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], capture_output=True, timeout=10, check=False)


async def stop_profile_and_wait() -> None:
    stop_existing_profile()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if not existing_profile_session():
            return
        await asyncio.sleep(0.25)
    raise RuntimeError("The previous automation Chrome process did not close")


async def connect_cdp(playwright: Any, port: int) -> BrowserSession | None:
    try:
        browser = await playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        contexts = browser.contexts
        if contexts:
            probe = await contexts[0].new_page()
            await probe.close()
            return BrowserSession(browser, contexts[0], None)
    except Exception:
        return None
    return None


async def launch_context(playwright: Any, config: Config) -> BrowserSession:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    existing = existing_profile_session()
    if existing and existing[1] != config.headless:
        target_mode = "hidden" if config.headless else "visible"
        LOGGER.info("Closing the old automation Chrome before starting %s mode", target_mode)
        await stop_profile_and_wait()
        existing = None
    if existing:
        existing_session = await connect_cdp(playwright, existing[0])
        if existing_session:
            LOGGER.info("Reusing the already-running automation Chrome session on port %s", existing[0])
            return existing_session
        LOGGER.info("Discarding an unresponsive automation Chrome session on port %s", existing[0])
        await stop_profile_and_wait()
    port = unused_local_port()
    chrome_args = [
        str(chrome_executable()),
        f"--user-data-dir={PROFILE_DIR}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--remote-allow-origins=http://localhost",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if config.headless:
        chrome_args.append("--headless=new")
    process = subprocess.Popen(chrome_args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline:
            try:
                session = await connect_cdp(playwright, port)
                if session:
                    session.process = process
                    return session
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError("Chrome exited before its local automation connection became available") from None
                await asyncio.sleep(0.25)
        raise RuntimeError("Timed out connecting to the dedicated Chrome process")
    except Exception:
        if process.poll() is None:
            process.terminate()
        raise


async def repair_tradingview_login(playwright: Any, config: Config, stop_event: asyncio.Event) -> bool:
    """Open headed Chrome and wait until the private screener works again."""
    with contextlib.suppress(FileNotFoundError):
        LOGIN_FILE.unlink()
    await stop_profile_and_wait()
    session = await launch_context(playwright, replace(config, headless=False))
    context = session.context
    pages = [page for page in context.pages if not page.is_closed()]
    login_page = pages[0] if pages else await context.new_page()
    probe = await context.new_page()
    try:
        set_automation_status("login_in_progress", 10, "Sign in to TradingView in the opened Chrome window")
        await login_page.goto("https://www.tradingview.com/accounts/signin/", wait_until="domcontentloaded", timeout=config.tradingview_page_timeout_seconds * 1000)
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline and not stop_event.is_set() and not STOP_FILE.exists():
            try:
                await probe.goto(config.tradingview_url, wait_until="domcontentloaded", timeout=config.tradingview_page_timeout_seconds * 1000)
                await probe.wait_for_timeout(1500)
                title = (await probe.title()).lower()
                body = await page_body(probe)
                if "page not found" not in title and "this isn't the page you're looking for" not in body:
                    for candidate in TV_MENU_CANDIDATES:
                        locator = await candidate_locator(probe, candidate)
                        if await locator.count() and await locator.first.is_visible():
                            LOGGER.info("TradingView login repaired; private screener is available")
                            set_automation_status("login_complete", 100, "TradingView connected; restarting hidden automation")
                            await asyncio.sleep(2)
                            return True
            except Exception:
                pass
            await asyncio.sleep(3)
        if STOP_FILE.exists() or stop_event.is_set():
            return False
        raise CycleFailure("TradingView login", "Timed out waiting for TradingView sign-in")
    finally:
        with contextlib.suppress(Exception):
            await probe.close()
        await session.close()
        await stop_profile_and_wait()


async def setup_mode(config: Config) -> None:
    require_playwright()
    LOGGER.info("Setup mode: the headed browser will remain open for manual setup.")
    async with async_playwright() as playwright:
        session = await launch_context(playwright, replace(config, headless=False))
        context = session.context
        tradingview_page = await context.new_page()
        rocket_page = await context.new_page()
        await tradingview_page.goto(config.tradingview_url)
        await rocket_page.goto(config.rocket_scanner_url)
        LOGGER.info("Log into TradingView, connect Drive in Rocket Scanner, and click Load Files once.")
        LOGGER.info("Select the Scanner Uploads folder if the browser asks for it.")
        await asyncio.to_thread(input, "Finish setup in the browser, then press Enter here to close setup: ")
        await session.close()


async def inspect_mode(config: Config) -> None:
    require_playwright()
    async with async_playwright() as playwright:
        session = await launch_context(playwright, config)
        context = session.context
        tv = await find_page(context, config.tradingview_url, "TradingView")
        rocket = await find_page(context, config.rocket_scanner_url, "Rocket Scanner")
        LOGGER.info("TradingView candidate selectors: %s", TV_MENU_CANDIDATES + TV_EXPORT_CANDIDATES)
        LOGGER.info("Rocket selectors: Load=%s Loading=%s Message=%s Checklist=%s", ROCKET_LOAD_SELECTOR, ROCKET_LOADING_SELECTOR, ROCKET_MESSAGE_SELECTOR, ROCKET_CHECKLIST_SELECTOR)
        await asyncio.to_thread(input, "Inspect mode is open. Press Enter to close it: ")
        await session.close()


def parse_datetime_on_date(date_value: datetime, at: clock_time, tz: ZoneInfo) -> datetime:
    return datetime.combine(date_value.date(), at, tzinfo=tz)


async def sleep_until(target: datetime, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        if STOP_FILE.exists():
            return
        seconds = (target - datetime.now(target.tzinfo)).total_seconds()
        if seconds <= 0:
            return
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=min(seconds, 30))
        except asyncio.TimeoutError:
            continue


def in_operating_window(current: datetime, config: Config) -> bool:
    return config.automation_start <= current.timetz().replace(tzinfo=None) <= config.automation_end


async def recurring_mode(config: Config) -> None:
    require_playwright()
    for control_file in (STOP_FILE, LOGIN_FILE):
        with contextlib.suppress(FileNotFoundError):
            control_file.unlink()
    await start_status_server()
    set_automation_status("idle", 0, "Waiting for the next scheduled cycle")
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop_event.set)
    async with async_playwright() as playwright:
        session = await launch_context(playwright, config)
        context = session.context
        final_ran_date: Optional[str] = None
        last_cycle_finished: Optional[datetime] = None
        next_random: Optional[datetime] = None
        was_paused = False
        try:
            while not stop_event.is_set():
                if STOP_FILE.exists():
                    set_automation_status("stopped", 0, "Automation stopped")
                    LOGGER.info("Stop requested")
                    break
                if PAUSE_FILE.exists():
                    set_automation_status("paused", 0, "Automation paused")
                    was_paused = True
                    await asyncio.sleep(5)
                    continue
                if was_paused:
                    message = f"Waiting for next cycle at {display_time(next_random)}" if next_random else "Waiting for the next scheduled cycle"
                    set_automation_status("idle", 0, message)
                    LOGGER.info("Automation resumed")
                    was_paused = False
                current = now_in(config.tz)
                if current.weekday() >= 5:
                    await sleep_until(current.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1), stop_event)
                    continue
                start = parse_datetime_on_date(current, config.automation_start, config.tz)
                end = parse_datetime_on_date(current, config.automation_end, config.tz)
                final_at = parse_datetime_on_date(current, config.final_cycle_time, config.tz)
                if current < start:
                    await sleep_until(start, stop_event)
                    next_random = None
                    continue
                if current > end:
                    await sleep_until(start + timedelta(days=1), stop_event)
                    next_random = None
                    continue
                if next_random is None:
                    next_random = current
                due_final = config.run_final_cycle and final_ran_date != current.date().isoformat() and current >= final_at
                due_random = current >= next_random
                if due_final or due_random:
                    if due_final and last_cycle_finished and abs((current - last_cycle_finished).total_seconds()) <= config.final_cycle_proximity_minutes * 60:
                        LOGGER.info("Final cycle skipped as a duplicate of the recent random cycle")
                        final_ran_date = current.date().isoformat()
                    else:
                        cycle_id = current.strftime("%Y%m%d_%H%M%S")
                        try:
                            await run_cycle(context, config, cycle_id)
                        except TradingViewLoginRequired as exc:
                            LOGGER.warning("TradingView login required: %s", exc)
                            set_automation_status("login_required", 0, "TradingView login required")
                            while not LOGIN_FILE.exists() and not STOP_FILE.exists() and not stop_event.is_set():
                                await asyncio.sleep(1)
                            if STOP_FILE.exists() or stop_event.is_set():
                                continue
                            await session.close()
                            repaired = await repair_tradingview_login(playwright, config, stop_event)
                            if not repaired:
                                continue
                            session = await launch_context(playwright, config)
                            context = session.context
                            next_random = now_in(config.tz)
                            set_automation_status("idle", 0, "TradingView connected; resuming automation")
                            continue
                        last_cycle_finished = now_in(config.tz)
                        if due_final:
                            final_ran_date = current.date().isoformat()
                    delay = random.randint(config.minimum_interval_minutes, config.maximum_interval_minutes)
                    next_random = last_cycle_finished + timedelta(minutes=delay) if last_cycle_finished else now_in(config.tz) + timedelta(minutes=delay)
                    LOGGER.info("Selected interval: %s minutes", delay)
                    LOGGER.info("Next cycle: %s", display_time(next_random))
                    set_automation_status("idle", 0, f"Waiting for next cycle at {display_time(next_random)}")
                    continue
                await asyncio.sleep(5)
        finally:
            await session.close()
            await stop_status_server()


async def once_mode(config: Config) -> None:
    require_playwright()
    await start_status_server()
    set_automation_status("running", 2, "Starting background automation")
    async with async_playwright() as playwright:
        session = await launch_context(playwright, config)
        context = session.context
        try:
            ok = await run_cycle(context, config, datetime.now().strftime("once_%Y%m%d_%H%M%S"))
            if not ok:
                raise CycleFailure("one-shot cycle", "The one-shot cycle did not complete successfully")
        finally:
            await session.close()
            if AUTOMATION_STATUS["state"] == "running":
                set_automation_status("error", AUTOMATION_STATUS["progress"], "Automation stopped before completion")
            await asyncio.sleep(3)
            await stop_status_server()


def main() -> int:
    parser = argparse.ArgumentParser(description="TradingView to Rocket Scanner browser automation")
    parser.add_argument("--setup", action="store_true", help="open the persistent browser for manual setup")
    parser.add_argument("--once", action="store_true", help="run exactly one cycle, ignoring schedule settings")
    parser.add_argument("--inspect", action="store_true", help="open both pages and print candidate selectors")
    args = parser.parse_args()
    try:
        config = load_config()
        if not config.scanner_uploads_folder.exists():
            raise ValueError(f"scanner_uploads_folder does not exist: {config.scanner_uploads_folder}")
        with SingleInstance():
            if args.setup:
                asyncio.run(setup_mode(config))
            elif args.inspect:
                asyncio.run(inspect_mode(config))
            elif args.once:
                asyncio.run(once_mode(config))
            else:
                asyncio.run(recurring_mode(config))
        return 0
    except KeyboardInterrupt:
        LOGGER.info("Stopped by user")
        return 0
    except Exception as exc:
        LOGGER.exception("Automation stopped: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
