@echo off
setlocal
chcp 65001 >nul
rem Mock chemical intake trips into Uroboros chem.db for testing /labventure/chem-intake
rem Usage (no args = menu):
rem   mock_data_for_test.bat add [YYYY-MM-DD] [--next]
rem   mock_data_for_test.bat clean
rem   mock_data_for_test.bat list
rem Optional env: UROBOROS_DIR (default Fullscale_V2\Uroboros_proj), CHEM_DB (explicit file)

set "SCRIPT=%~dp0server\scripts\mockChemData.js"
where node >nul 2>nul || (echo [ERROR] node not found in PATH & pause & exit /b 1)

if not "%~1"=="" (
  node --no-warnings "%SCRIPT%" %*
  exit /b %errorlevel%
)

:menu
echo.
echo ===== Mock chem intake data (chem.db) =====
echo  1. Add trips for TODAY
echo  2. Add trips for a specific date
echo  3. Add trips for a date + next day (for offset test)
echo  4. List mock trips
echo  5. Clean all mock trips
echo  0. Exit
set "CH="
set /p "CH=Select: "
if "%CH%"=="1" node --no-warnings "%SCRIPT%" add
if "%CH%"=="2" call :askdate && node --no-warnings "%SCRIPT%" add %D%
if "%CH%"=="3" call :askdate && node --no-warnings "%SCRIPT%" add %D% --next
if "%CH%"=="4" node --no-warnings "%SCRIPT%" list
if "%CH%"=="5" (
  set "OK="
  set /p "OK=Delete all mock trips? (y/N): "
  call :doclean
)
if "%CH%"=="0" exit /b 0
goto menu

:askdate
set "D="
set /p "D=Date (YYYY-MM-DD): "
if "%D%"=="" (echo [ERROR] no date & exit /b 1)
exit /b 0

:doclean
if /i "%OK%"=="y" node --no-warnings "%SCRIPT%" clean
exit /b 0
