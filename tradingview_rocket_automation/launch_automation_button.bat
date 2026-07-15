@echo off
setlocal
cd /d "%~dp0"
echo %~1| findstr /i /c:"rocket-scanner://run-day" >nul && start "" /b .venv\Scripts\pythonw.exe tradingview_rocket_automation.py
echo %~1| findstr /i /c:"rocket-scanner://pause" >nul && echo paused>automation_pause.txt
echo %~1| findstr /i /c:"rocket-scanner://resume" >nul && del /q automation_pause.txt 2>nul
echo %~1| findstr /i /c:"rocket-scanner://stop" >nul && echo stop>automation_stop.txt
endlocal
