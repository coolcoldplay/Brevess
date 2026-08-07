@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
if errorlevel 1 (
  echo.
  echo Brevess Local Companion removal failed.
  pause
  exit /b 1
)
echo.
echo Brevess Local Companion registration removed successfully.
pause
