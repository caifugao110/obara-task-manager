@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"
set "LOG_DIR=%SCRIPT_DIR%logs"

rem Administrator rights are required when the services were started as a
rem Windows service / scheduled task (they then run in Session 0 under another
rem account). taskkill on such a process fails with "Access is denied".
set "IS_ADMIN=0"
net session >nul 2>&1
if not errorlevel 1 set "IS_ADMIN=1"

echo ===============================================
echo OBara Task Manager stop
echo ===============================================
if "%IS_ADMIN%"=="0" echo [INFO] Running without Administrator rights.
echo.

if /i "%~1"=="--elevated" (
    echo [INFO] Elevated retry run, offline backup step is skipped.
) else (
    call :trigger_backup
)

call :stop_by_port %BACKEND_PORT% backend
call :stop_by_port %FRONTEND_PORT% frontend
call :sweep_by_path
call :clear_pid_files

echo.
echo ===============================================
echo Result
echo ===============================================
set "STILL_RUNNING=0"
call :check_port %BACKEND_PORT% backend
if errorlevel 1 set "STILL_RUNNING=1"
call :check_port %FRONTEND_PORT% frontend
if errorlevel 1 set "STILL_RUNNING=1"

if "%STILL_RUNNING%"=="1" (
    echo.
    call :elevate_retry "%~1"
) else (
    echo.
    echo [OK] All services stopped, ports are free.
)

echo.
echo Stop command complete.
echo.
pause
goto :end

:trigger_backup
echo [INFO] Creating offline backup before shutdown...
powershell -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:%BACKEND_PORT%/api/system/maintenance/offline-backup' -Method POST -TimeoutSec 30; Write-Host ('[OK] Offline backup API returned: ' + $r.message + ' / ' + $r.reason) } catch { Write-Host '[WARN] Failed to trigger backup via API, will skip.' }"

exit /b 0

rem ---------------------------------------------------------------
rem Stop one service by the port it listens on.
rem
rem start.bat launches each service as a deep process tree:
rem   wscript.exe -> cmd.exe (VBS) -> node.exe (npm) -> cmd.exe (npm shell)
rem   -> node.exe (nodemon / vite) -> node.exe (server.js / vite child)
rem Only the LAST one owns the listening socket. Killing just that PID (the
rem old behaviour) leaves every parent alive: the redirecting cmd.exe keeps
rem backend.log / frontend.log locked, and nodemon / vite keep running and
rem restart the service as soon as a file changes.
rem
rem So: walk UP from the listening PID to the top-most node.exe/cmd.exe of
rem the same tree, then taskkill /F /T that root. /T kills the whole subtree
rem downwards, so nothing of the tree survives. The walk never crosses into a
rem non node/cmd process (wscript.exe, explorer.exe, Code.exe ...), so
rem unrelated shells are not touched.
rem ---------------------------------------------------------------
:stop_by_port
set "PORT=%~1"
set "NAME=%~2"

echo.
echo --- Stopping %NAME% (port %PORT%) ---

netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK] %NAME% is not running, port %PORT% is free.
    exit /b 0
)

powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $port=%PORT%; $targets=@(); foreach($l in (netstat -ano)){ if(($l -match (':'+$port+'\s')) -and ($l -match 'LISTENING')){ $targets += ($l -split '\s+')[-1] } }; $targets=@($targets | Sort-Object -Unique | Where-Object { $_ -match '^\d+$' }); if($targets.Count -eq 0){ Write-Host '[WARN] Could not resolve a PID for port '+$port+'.'; exit 1 }; foreach($t in $targets){ $root=[int]$t; $cur=Get-CimInstance Win32_Process -Filter ('ProcessId='+$t); $guard=0; while($cur -and $guard -lt 8){ $par=Get-CimInstance Win32_Process -Filter ('ProcessId='+$cur.ParentProcessId); if(-not $par){ break }; if(($par.Name -ne 'node.exe') -and ($par.Name -ne 'cmd.exe')){ break }; if($par.CommandLine -and ($par.CommandLine -match 'stop\.bat')){ break }; $root=[int]$par.ProcessId; $cur=$par; $guard++ }; if($root -ne [int]$t){ Write-Host ('[INFO] Port '+$port+' held by PID '+$t+', killing its tree from root PID '+$root+'.') } else { Write-Host ('[INFO] Killing process tree rooted at PID '+$root+'.') }; taskkill /F /T /PID $root 2>&1 | Out-Null; if($LASTEXITCODE -ne 0){ Write-Host ('[ERROR] taskkill could not stop PID '+$root+' (exit code '+$LASTEXITCODE+'). Administrator rights are probably required.') } }"

ping -n 2 127.0.0.1 >nul

rem One retry, in case something was re-spawned while the tree was dying.
netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port %PORT% is still in use, retrying once...
    powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $port=%PORT%; foreach($l in (netstat -ano)){ if(($l -match (':'+$port+'\s')) -and ($l -match 'LISTENING')){ $p=($l -split '\s+')[-1]; if($p -match '^\d+$'){ taskkill /F /T /PID $p 2>&1 | Out-Null } } }"
    ping -n 2 127.0.0.1 >nul
)

netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK] %NAME% stopped, port %PORT% released.
) else (
    echo [FAIL] Port %PORT% is still LISTENING.
)
exit /b 0

rem ---------------------------------------------------------------
rem Kill leftovers that no longer hold a port.
rem When nodemon crashes it keeps its parent cmd.exe alive while no longer
rem listening on 5000, so a port based stop cannot see it at all. This sweeps
rem node.exe (nodemon / vite / server.js) and cmd.exe ("npm run dev") whose
rem command line points into this installation.
rem Reading another process command line needs sufficient rights; when it is
rem unavailable the sweep silently finds nothing and does no harm.
rem ---------------------------------------------------------------
:sweep_by_path
echo.
echo --- Sweeping leftover node/cmd processes of this installation ---
powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $anchor=[regex]::Escape('%SCRIPT_DIR%'); $me=$PID; $all=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match $anchor) -and ($_.ProcessId -ne $me) -and ($_.CommandLine -notmatch 'stop\.bat') -and ((($_.Name -eq 'node.exe') -and ($_.CommandLine -match 'nodemon|vite|server\.js')) -or (($_.Name -eq 'cmd.exe') -and ($_.CommandLine -match 'npm run dev'))) }); if($all.Count -eq 0){ Write-Host '[OK] No leftover processes found.'; exit 0 }; $ids=@($all | ForEach-Object { $_.ProcessId }); foreach($p in $all){ if($ids -notcontains $p.ParentProcessId){ Write-Host ('[INFO] Stopping leftover tree, root PID '+$p.ProcessId); taskkill /F /T /PID $p.ProcessId 2>&1 | ForEach-Object { if($_ -match 'denied'){ Write-Host ('[ERROR] ' + $_) } } } }; foreach($p in $all){ if(Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue){ taskkill /F /PID $p.ProcessId 2>&1 | Out-Null } }; Write-Host '[OK] Leftover sweep finished.'"
exit /b 0

:clear_pid_files
if exist "%LOG_DIR%\backend.pid" del /q "%LOG_DIR%\backend.pid" >nul 2>&1
if exist "%LOG_DIR%\frontend.pid" del /q "%LOG_DIR%\frontend.pid" >nul 2>&1
exit /b 0

rem errorlevel 1 = port still listening
:check_port
netstat -ano 2>nul | findstr ":%~1 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK]   %~2: stopped, port %~1 free.
    exit /b 0
)
echo [FAIL] %~2: still listening on port %~1.
exit /b 1

rem ---------------------------------------------------------------
rem Nothing was stopped and we are not elevated: the services are most
rem likely running as a service / scheduled task in Session 0, which a normal
rem user cannot terminate. Re-run the very same script elevated (one UAC
rem prompt) instead of telling the user to do it by hand.
rem ---------------------------------------------------------------
:elevate_retry
if /i "%~1"=="--elevated" goto :elevate_failed
if "%IS_ADMIN%"=="1" goto :elevate_failed

echo [WARN] Some processes survived. They were most likely started as a
echo        service / scheduled task, i.e. in Session 0 under another account,
echo        which requires Administrator rights to stop.
echo [INFO] Re-launching stop.bat as Administrator...
powershell -NoProfile -Command "try { Start-Process -FilePath '%SCRIPT_DIR%stop.bat' -ArgumentList '--elevated' -Verb RunAs; Write-Host '[OK] Elevated instance started, finish it in the new window.' } catch { Write-Host '[WARN] Elevation was cancelled or failed.' }"
exit /b 1

:elevate_failed
echo [ERROR] Some services are still running and could not be stopped.
echo         Try one of these:
echo           - right click stop.bat ^> Run as administrator
echo           - or stop the Windows service / scheduled task that owns them
echo           - or check Task Manager for node.exe and end it manually
exit /b 1

:end
endlocal
exit /b 0
