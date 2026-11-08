@echo off
chcp 65001 >nul 2>&1
title Backend Report
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%backend-report.ps1" %*
echo.
pause
