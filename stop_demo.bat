@echo off
echo Stopping all RESQ-AI processes...
taskkill /F /IM node.exe /T 2>nul
taskkill /F /FI "WINDOWTITLE eq RESQ-AI*" 2>nul
echo All demo processes stopped cleanly.
pause
