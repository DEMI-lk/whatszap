@echo off
setlocal
cd /d "%~dp0"
title WhatsZAP launcher

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"

where node >nul 2>nul
if errorlevel 1 (
    echo [run] Node.js was not found on PATH.
    echo [run] Install Node.js 18+ from https://nodejs.org and try again.
    pause
    exit /b 1
)

if not exist "%ELECTRON%" (
    echo [run] Dependencies are missing - running npm install...
    call npm install
    if errorlevel 1 (
        echo [run] npm install failed.
        pause
        exit /b 1
    )
    if not exist "%ELECTRON%" (
        echo [run] Electron is still missing - the npm install did not complete.
        pause
        exit /b 1
    )
)

echo [run] Building...
call npm run build
if errorlevel 1 (
    echo [run] Build failed - see the errors above.
    pause
    exit /b 1
)

echo [run] Starting WhatsZAP...
start "" "%ELECTRON%" . %*
exit /b 0
