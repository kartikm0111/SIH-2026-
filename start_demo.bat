@echo off
echo ========================================================
echo   RESQ-AI: STARTING AUTONOMOUS MISSION CONTROL DEMO
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Starting Express + Socket.IO API Gateway (Port 4000)...
start "RESQ-AI: API Gateway" cmd /k "node --env-file=.env api/server.mjs"

timeout /t 2 /nobreak >nul

echo [2/3] Starting Autonomous Flight Simulation Worker...
start "RESQ-AI: Flight Worker" cmd /k "cd workers && ..\.venv\Scripts\activate && python flight.py"

timeout /t 1 /nobreak >nul

echo [3/3] Starting YOLOv8 Aerial Human Detection Worker...
start "RESQ-AI: Vision Worker" cmd /k "cd workers && ..\.venv\Scripts\activate && python vision.py"

echo.
echo ========================================================
echo   ALL SYSTEMS ONLINE! 
echo   Open your Vercel link or http://localhost:3000
echo ========================================================
pause
