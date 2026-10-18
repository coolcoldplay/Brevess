@echo off
setlocal
title BREVESS MCP Server
cd /d "%~dp0"

echo Starting the BREVESS MCP bridge on localhost.
echo Keep this window open while an external Agent is connected.
echo.
echo The server prints a one-time Workbench connect URL.
echo Its client token is stored at:
echo   %%LOCALAPPDATA%%\BrevessMcp\bridge-token
echo.
echo This starts write transport, but every write still requires a human-approved
echo task scope inside the BREVESS Workbench.
echo.

node mcp\server.js --http-only --allow-write
if errorlevel 1 pause
endlocal
