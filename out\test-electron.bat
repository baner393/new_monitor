@echo off
rem === Electron Binary Test ===
set PKG=%~dp0turtle-monitor-win32-x64
if not exist "%PKG%" set PKG=%~dp0
echo Looking for exe: %PKG%\turtle-monitor.exe
if not exist "%PKG%\turtle-monitor.exe" (
    echo [ERR] Cannot find turtle-monitor.exe
    pause
    exit /b 1
)
echo Starting minimal Electron test app...
cd /d "%PKG%\resources\test-app"
start /b "" "%PKG%\turtle-monitor.exe" --no-sandbox .
timeout /t 5 /nobreak >nul
tasklist | findstr /i "turtle-monitor" >nul && (
    echo [PASS] Electron running! Test window should appear.
    pause
    taskkill /f /im turtle-monitor.exe >nul 2>&1
) || (
    echo [FAIL] Electron did not start.
    echo Install: https://aka.ms/vs/17/release/vc_redist.x64.exe
    echo Or run in cmd: "%PKG%\turtle-monitor.exe" --no-sandbox
    pause
)
