@echo off
REM Double-click shim for install-windows.ps1 — installer always pulls latest.
REM v1.3.1+ includes in-app update via plugin Settings, so this script is
REM only needed for first-time install or catastrophic recovery.
REM
REM Bypasses the user's PowerShell execution policy for THIS invocation only —
REM it does not change any system-wide setting.
REM
REM The real installer (with hash verification, vault picker, etc.) lives in
REM install-windows.ps1 right next to this file.

setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-windows.ps1"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
