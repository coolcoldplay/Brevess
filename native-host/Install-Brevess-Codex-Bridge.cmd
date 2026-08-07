@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Brevess Local Companion installation failed.
  pause
  exit /b 1
)
echo.
echo Brevess Local Companion installed successfully.
pause
