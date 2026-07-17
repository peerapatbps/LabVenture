@echo off
setlocal

echo ============================================
echo  Fullscale Builder
echo ============================================
echo.

:: ---- Uroboros ----
echo [1/2] Publishing Uroboros...
dotnet publish "C:\Users\peera\OneDrive\Desktop\Uroboros\Uroboros\Uroboros\Uroboros.csproj" ^
  --configuration Release ^
  --runtime win-x64 ^
  --no-self-contained ^
  --output "C:\Users\peera\OneDrive\Desktop\Fullscale_V2\Uroboros_proj"

if errorlevel 1 (
  echo [ERROR] Uroboros publish failed.
  pause
  exit /b 1
)
echo [OK] Uroboros published.
echo.

:: ---- BellBeast ----
echo [2/2] Publishing BellBeast...
dotnet publish "C:\Users\peera\OneDrive\Desktop\BellBeast\BellBeast\BellBeast\BellBeast.csproj" ^
  --configuration Release ^
  --runtime win-x64 ^
  --no-self-contained ^
  --output "C:\Users\peera\OneDrive\Desktop\Fullscale_V2\BellBeast_proj"

if errorlevel 1 (
  echo [ERROR] BellBeast publish failed.
  pause
  exit /b 1
)
echo [OK] BellBeast published.
echo.

echo ============================================
echo  Build complete.
echo ============================================
pause
