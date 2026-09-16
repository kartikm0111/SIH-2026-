@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo   RESQ-AI // OFFLINE MISSION CONTROL DEMO
echo ========================================================

if not exist ".env" (
  echo [BLOCKED] Missing .env. Copy .env.example to .env and set WORKER_TOKEN.
  pause
  exit /b 1
)

if not exist "web\node_modules" (
  echo [BLOCKED] Web dependencies are not installed. Run: cd web ^&^& npm install
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [BLOCKED] Python virtual environment is missing. Run setup from the README before the demo.
  pause
  exit /b 1
)

echo [1/4] API Gateway          http://127.0.0.1:4000
start "RESQ-AI: API Gateway" /D "%~dp0" cmd /k "node --env-file=.env api/server.mjs"
timeout /t 2 /nobreak >nul

echo [2/4] Flight Worker         5 Hz local telemetry
start "RESQ-AI: Flight Worker" /D "%~dp0workers" cmd /k "..\.venv\Scripts\python.exe flight.py"

echo [3/4] YOLO Vision Worker    local inference / synthetic feed fallback
start "RESQ-AI: Vision Worker" /D "%~dp0workers" cmd /k "..\.venv\Scripts\python.exe vision.py"

echo [4/4] Command Center        http://127.0.0.1:3000
start "RESQ-AI: Command Center" /D "%~dp0web" cmd /k "npm run dev"

echo.
echo System launch commands issued. Wait for the Command Center window to show Ready,
echo then open http://127.0.0.1:3000 in a browser.
pause
