@echo off
echo [1/2] Building React client...
cd /d "%~dp0client"
call npm run build
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)
echo [2/2] Build complete! Restarting server...
cd /d "%~dp0server"
echo Done. Restart the server manually if it is already running.
pause
