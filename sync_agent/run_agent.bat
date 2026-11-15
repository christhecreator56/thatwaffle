@echo off
setlocal
cd /d "%~dp0"

echo =====================================================================
echo  Starting That Waffle Place Live Sync Agent...
echo =====================================================================

if exist ".venv\Scripts\python.exe" (
    set "PYTHON_EXE=.venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)

"%PYTHON_EXE%" -m sync_agent.agent --config config.json %*
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Agent stopped with error code %errorlevel%.
    pause
)
