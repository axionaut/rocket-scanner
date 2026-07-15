@echo off
setlocal
set "ROOT=%~dp0"
set "LAUNCHER=%ROOT%launch_automation_button.bat"
reg add "HKCU\Software\Classes\rocket-scanner" /ve /d "URL:Rocket Scanner Automation" /f >nul
reg add "HKCU\Software\Classes\rocket-scanner" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\rocket-scanner\shell\open\command" /ve /d "\"%LAUNCHER%\" \"%%1\"" /f >nul
echo Rocket Scanner's Run Automation button is now registered.
