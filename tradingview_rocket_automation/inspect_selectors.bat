@echo off
setlocal
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python tradingview_rocket_automation.py --inspect
endlocal
