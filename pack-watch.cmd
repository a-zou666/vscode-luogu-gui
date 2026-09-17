@echo off
REM One-click launcher for the auto-pack watcher (ASCII-only on purpose:
REM this file must render correctly in a GBK console).
REM Double-click to start; close the window (or Ctrl+C) to stop watching.
cd /d "%~dp0"
title vscode-luogu auto-pack watcher
echo ==================================================
echo   vscode-luogu auto-pack watcher
echo   watch source changes -^> rebuild -^> repack .vsix
echo   Close this window to stop.
echo ==================================================
echo.
call npm run pack:watch
echo.
echo [exited] Press any key to close...
pause >nul
