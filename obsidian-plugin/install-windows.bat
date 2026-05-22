@echo off
REM Double-click shim for install-windows.ps1.
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
