@echo off
REM Backs up WhatsZAP app data (profiles, settings, WhatsApp sessions) to a
REM timestamped folder. Run whenever you want a restore point. Sessions are
REM sensitive - keep the backup folder private, never upload it anywhere.
setlocal
set SRC=%APPDATA%\WhatsZAP
if not exist "%SRC%" (
  echo No WhatsZAP data found at %SRC%
  exit /b 1
)
set STAMP=%DATE:~-4%-%DATE:~4,2%-%DATE:~7,2%_%TIME:~0,2%-%TIME:~3,2%
set STAMP=%STAMP: =0%
set DEST=%USERPROFILE%\WhatsZAP-backup\%STAMP%
robocopy "%SRC%" "%DEST%" /E /R:1 /W:1 /NFL /NDL /NJH | findstr /c:"Directories" /c:"Files" /c:"Bytes"
echo.
echo Backup complete: %DEST%
echo To restore: close WhatsZAP, copy the folder contents back to %SRC%
endlocal
