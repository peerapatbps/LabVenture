$host.UI.RawUI.WindowTitle = "LabVenture Server"

$exeDir = [System.IO.Path]::GetDirectoryName([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
$serverPath = Join-Path $exeDir "server"
$port = 3001

Write-Host "LabVenture Server" -ForegroundColor Cyan
Write-Host "Root  : $exeDir"

if (-not (Test-Path $serverPath)) {
    Write-Host "ERROR: ไม่พบโฟลเดอร์ server ที่ $serverPath" -ForegroundColor Red
    Read-Host "กด Enter เพื่อปิด"; exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: ไม่พบ node.exe — กรุณาติดตั้ง Node.js" -ForegroundColor Red
    Read-Host "กด Enter เพื่อปิด"; exit 1
}

# Always kill any process on port 3001 before starting
Write-Host "ล้าง port $port..." -ForegroundColor Yellow
$lines = netstat -ano | Select-String ":$port\s" | Select-String "LISTENING"
foreach ($line in $lines) {
    $pidStr = ($line.ToString().Trim() -split '\s+')[-1]
    if ($pidStr -match '^\d+$') {
        Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 800

Write-Host "Starting on port $port..." -ForegroundColor Green
Write-Host ""
Set-Location $serverPath

try {
    & node index.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nServer หยุดทำงาน (exit $LASTEXITCODE)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}

Read-Host "`nกด Enter เพื่อปิด"
