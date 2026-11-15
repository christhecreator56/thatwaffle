@echo off
setlocal enabledelayedexpansion

echo =====================================================================
echo  That Waffle Place - Excel Live Sync Agent Setup for Windows
echo =====================================================================
echo.

cd /d "%~dp0"

:: 1. Check Python installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found in your system PATH.
    echo Please install Python 3.8 or higher from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VER=%%i
echo [INFO] Detected: %PYTHON_VER%

:: 2. Create Python virtual environment (.venv)
if not exist ".venv" (
    echo [INFO] Creating isolated Python virtual environment (.venv)...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Existing virtual environment found (.venv).
)

:: 3. Upgrade pip and install dependencies
echo [INFO] Installing required Python libraries (openpyxl, watchdog, requests)...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed successfully.

:: 4. Ensure config.json exists
if not exist "config.json" (
    if exist "config.example.json" (
        echo [INFO] Initializing config.json from config.example.json...
        copy config.example.json config.json >nul
        echo [OK] Created config.json.
    )
)

echo.
echo =====================================================================
echo  Installation Complete!
echo =====================================================================
echo  1. Edit "config.json" to specify your workbook path and device key.
echo  2. Test manually by running "run_agent.bat".
echo  3. To enable automatic startup in background, run:
echo     powershell -ExecutionPolicy Bypass -File setup_task.ps1
echo =====================================================================
echo.
pause
