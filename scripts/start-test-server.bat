@echo off
rem One-click test server launcher: double-click this file in Explorer.
rem The actual logic lives in start-test-server.mjs (cross-platform,
rem also used by "pnpm test:server"); this bat is a thin wrapper.
rem Keep this file ASCII-only: cmd parses it with the ANSI codepage,
rem and UTF-8 Chinese comments get mangled into bogus commands.
node "%~dp0start-test-server.mjs" %*
pause
