@echo off
cd /d D:\all\lightframe\new_monitor
set "EXE=out\win-unpacked\Turtle Monitor.exe"
set "ICO=icon.ico"
set "RCEDIT=node_modules\electron-winstaller\vendor\rcedit.exe"

if not exist "%EXE%" (
    echo ERROR: %EXE% not found
    exit /b 1
)
if not exist "%ICO%" (
    echo ERROR: %ICO% not found
    exit /b 1
)

echo Setting icon on %EXE% to %ICO%...
"%RCEDIT%" "%EXE%" --set-icon "%ICO%"
if %ERRORLEVEL% EQU 0 (
    echo Icon set successfully!
) else (
    echo Icon set failed with error %ERRORLEVEL%
)