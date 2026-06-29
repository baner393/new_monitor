@echo off
rem === Turtle Monitor Diagnostic ===
set PKG=%~dp0turtle-monitor-win32-x64
if not exist "%PKG%" set PKG=%~dp0
echo Using: %PKG%\turtle-monitor.exe
echo Starting app...
start /b "" "%PKG%\turtle-monitor.exe" --no-sandbox
timeout /t 3 /nobreak >nul
echo Checking process...
tasklist | findstr /i "turtle-monitor" >nul && (
    echo [PASS] App is running!
    echo NOTE: Transparent desktop pet - invisible window.
    echo Check Task Manager for confirmation.
    pause
    taskkill /f /im turtle-monitor.exe >nul 2>&1
    echo Closed.
) || (
    echo [FAIL] App NOT running.
    echo Check vc_redist or run in cmd to see errors.
    pause
)
