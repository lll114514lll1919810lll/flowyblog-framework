@echo off
setlocal EnableExtensions

rem Usage: start-test-server.bat [port]
set "PORT=%~1"
if not defined PORT set "PORT=3000"

rem The port must contain digits only.
for /f "delims=0123456789" %%d in ("%PORT%") do goto :bad_port

rem Drop leading zeros so the numeric comparison below stays decimal.
set "DIGITS="
for /f "tokens=* delims=0" %%p in ("%PORT%") do set "DIGITS=%%p"
if not defined DIGITS goto :bad_port
if not "%DIGITS:~5%"=="" goto :bad_port
if %DIGITS% gtr 65535 goto :bad_port
set "PORT=%DIGITS%"

if not exist "%~dp0..\node_modules" (
  echo node_modules was not found. Run pnpm install first. 1>&2
  exit /b 1
)

echo Starting test server: http://localhost:%PORT%
echo Press Ctrl+C to stop the server.

call pnpm dev --port %PORT%
exit /b %ERRORLEVEL%

:bad_port
echo Invalid port: %~1 ^(expected a number between 1 and 65535^) 1>&2
exit /b 1
