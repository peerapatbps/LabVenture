@echo off
echo Stopping LabVenture...
taskkill /F /IM node.exe /T >nul 2>&1
echo Done.
