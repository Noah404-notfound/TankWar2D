# TankWar - Online Tunnel Launcher
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  🎮  TANKWAR - TẠO LINK CHƠI ONLINE VỚI BẠN BÈ KHÁC LAN  " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Tìm server exe
$ServerExe = Join-Path $ScriptDir ".tools\tankwar-server.exe"
if (-not (Test-Path $ServerExe)) {
    $found = Get-ChildItem -Path (Join-Path $ScriptDir ".stack-work") -Filter "tankwar-server.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $ServerExe = $found.FullName }
}

if (-not (Test-Path $ServerExe)) {
    Write-Host "[LỖI] Không tìm thấy tankwar-server.exe. Hãy kiểm tra lại thư mục .tools hoặc build lại." -ForegroundColor Red
    pause
    exit 1
}

# 1. Khởi động Haskell Dedicated Server
Write-Host "[1/3] Đang khởi chạy TankWar Haskell Server (Port 8081)..." -ForegroundColor Green
$serverProc = Start-Process -FilePath $ServerExe -ArgumentList "--port 8081" -PassThru -WindowStyle Hidden

# 2. Khởi động Node Web Proxy Server
Write-Host "[2/3] Đang khởi chạy Web Client & Reverse Proxy (Port 5173)..." -ForegroundColor Green
$webScript = Join-Path $ScriptDir "web\preview-server.js"
$webProc = Start-Process -FilePath "node" -ArgumentList "`"$webScript`" 5173" -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 2

# 3. Khởi chạy Cloudflare Tunnel
$cloudflared = Join-Path $ScriptDir ".tools\cloudflared.exe"
if (-not (Test-Path $cloudflared)) {
    Write-Host "[LỖI] Không tìm thấy .tools\cloudflared.exe" -ForegroundColor Red
    Stop-Process -Id $serverProc.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $webProc.Id -ErrorAction SilentlyContinue
    pause
    exit 1
}

Write-Host "[3/3] Đang kết nối Cloudflare Tunnel để tạo link Public HTTPS..." -ForegroundColor Green
Write-Host ""
Write-Host "----------------------------------------------------------" -ForegroundColor Yellow
Write-Host "👉 Hãy tìm dòng có link dạng: https://xxxx.trycloudflare.com bên dưới." -ForegroundColor Yellow
Write-Host "👉 Copy link đó gửi cho bạn bè ở khác mạng LAN là vào chơi được ngay!" -ForegroundColor Cyan
Write-Host "👉 Nhấn Ctrl + C để dừng chơi và tắt server." -ForegroundColor Gray
Write-Host "----------------------------------------------------------" -ForegroundColor Yellow
Write-Host ""

try {
    & $cloudflared tunnel --url http://127.0.0.1:5173
}
finally {
    Write-Host "`nĐang tắt server..." -ForegroundColor Yellow
    Stop-Process -Id $serverProc.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $webProc.Id -ErrorAction SilentlyContinue
    Write-Host "Đã đóng toàn bộ tiến trình." -ForegroundColor Green
}

