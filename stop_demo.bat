@echo off
echo Closing RESQ-AI demo windows only...
taskkill /F /FI "WINDOWTITLE eq RESQ-AI:*" /T >nul 2>nul
echo RESQ-AI demo processes closed. Other Node.js applications were left untouched.
pause
