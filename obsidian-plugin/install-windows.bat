@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title NNN HF Sync - Plugin Installer

echo.
echo ============================================================
echo   NNN HF Sync Plugin Installer for Windows
echo   Version 1.1.0
echo ============================================================
echo.

:: ── Locate Obsidian vault list from obsidian.json ────────────────────────────
set "OBSIDIAN_CFG=%APPDATA%\obsidian\obsidian.json"

if not exist "%OBSIDIAN_CFG%" (
    echo [ERROR] Could not find Obsidian config at:
    echo         %OBSIDIAN_CFG%
    echo.
    echo Make sure Obsidian is installed and has been opened at least once.
    goto :fail
)

:: Parse vault paths from obsidian.json using PowerShell
echo Detecting Obsidian vaults...
set "PS_CMD=Get-Content '%OBSIDIAN_CFG%' | ConvertFrom-Json | Select-Object -ExpandProperty vaults | ForEach-Object { $_.PSObject.Properties.Value.path } | Where-Object { $_ -ne $null }"

:: Write vault list to a temp file
set "TMPFILE=%TEMP%\nnn_vaults_%RANDOM%.txt"
powershell -NoProfile -Command "%PS_CMD%" > "%TMPFILE%" 2>nul

:: Count vaults
set VAULT_COUNT=0
for /f "usebackq delims=" %%L in ("%TMPFILE%") do (
    set "VAULT_!VAULT_COUNT!=%%L"
    set /a VAULT_COUNT+=1
)
del "%TMPFILE%" 2>nul

if %VAULT_COUNT%==0 (
    echo [ERROR] No vaults found in Obsidian config.
    echo         Open Obsidian and create or open a vault first.
    goto :fail
)

:: ── List vaults ───────────────────────────────────────────────────────────────
echo.
echo Found %VAULT_COUNT% vault(s):
echo.
for /l %%I in (0,1,%VAULT_COUNT%) do (
    if defined VAULT_%%I (
        set /a DISPLAY=%%I+1
        echo   [!DISPLAY!] !VAULT_%%I!
    )
)
echo.

:: Auto-select if only one vault
if %VAULT_COUNT%==1 (
    echo Only one vault found - installing automatically.
    set "TARGET_VAULT=%VAULT_0%"
    goto :install
)

:: Multiple vaults - ask user to pick
:pick
set /p CHOICE="Enter vault number to install into (1-%VAULT_COUNT%): "
if "%CHOICE%"=="" goto :pick

set /a IDX=%CHOICE%-1
if %IDX% LSS 0 goto :badchoice
if %IDX% GEQ %VAULT_COUNT% goto :badchoice

call set "TARGET_VAULT=%%VAULT_%IDX%%%"
goto :install

:badchoice
echo Invalid choice. Please enter a number between 1 and %VAULT_COUNT%.
goto :pick

:: ── Install ───────────────────────────────────────────────────────────────────
:install
set "PLUGIN_DIR=%TARGET_VAULT%\.obsidian\plugins\nnn-hf-sync"

echo.
echo Installing to:
echo   %PLUGIN_DIR%
echo.

if not exist "%PLUGIN_DIR%" (
    mkdir "%PLUGIN_DIR%"
    if errorlevel 1 (
        echo [ERROR] Could not create plugin directory.
        goto :fail
    )
)

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

if not exist "%SCRIPT_DIR%\main.js" (
    echo [ERROR] main.js not found next to install.bat
    echo         Expected: %SCRIPT_DIR%\main.js
    goto :fail
)
if not exist "%SCRIPT_DIR%\manifest.json" (
    echo [ERROR] manifest.json not found next to install.bat
    echo         Expected: %SCRIPT_DIR%\manifest.json
    goto :fail
)

copy /Y "%SCRIPT_DIR%\main.js"       "%PLUGIN_DIR%\main.js"       >nul
if errorlevel 1 ( echo [ERROR] Failed to copy main.js & goto :fail )

copy /Y "%SCRIPT_DIR%\manifest.json" "%PLUGIN_DIR%\manifest.json" >nul
if errorlevel 1 ( echo [ERROR] Failed to copy manifest.json & goto :fail )

:: ── Enable plugin in community-plugins.json ───────────────────────────────────
set "COMMUNITY_JSON=%TARGET_VAULT%\.obsidian\community-plugins.json"

powershell -NoProfile -Command ^
    "$f='%COMMUNITY_JSON%';" ^
    "if (Test-Path $f) { $list = Get-Content $f | ConvertFrom-Json } else { $list = @() };" ^
    "if ($list -notcontains 'nnn-hf-sync') { $list += 'nnn-hf-sync'; $list | ConvertTo-Json | Set-Content $f };" ^
    "Write-Host 'Plugin enabled in community-plugins.json'"

echo.
echo ============================================================
echo   SUCCESS - Plugin installed!
echo ============================================================
echo.
echo Next steps:
echo   1. Open Obsidian (or restart it if already open)
echo   2. Settings ^> Community Plugins ^> enable "NNN HF Sync"
echo   3. Configure the plugin:
echo        Space URL  : https://ipagoaga-obsidian-sync.hf.space
echo        Username   : ^<your username^>
echo        Password   : ^<your password / temp password^>
echo        Document ID: nnn-vault  (alphanumeric+hyphens only, no slashes)
echo   4. Click Connect
echo.
pause
exit /b 0

:fail
echo.
echo Installation failed. See error above.
echo.
pause
exit /b 1
