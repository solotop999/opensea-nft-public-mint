@echo off
setlocal

chcp 65001 >nul
cd /d "%~dp0"

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Windows PowerShell.
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
exit /b %errorlevel%
