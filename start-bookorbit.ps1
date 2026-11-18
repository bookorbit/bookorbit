[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "BookOrbit Launcher"

$url = "http://127.0.0.1:3500"
$healthUrl = "$url/api/v1/health"

# 1. Быстрая проверка: если сервер уже активен, сразу открываем браузер
try {
    $res = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($res.StatusCode -eq 200) {
        Start-Process $url
        exit 0
    }
} catch {}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "         BookOrbit Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 2. Обеспечиваем постоянную работу фоновой службы BookOrbit
Write-Host "[1/2] Запуск службы BookOrbit в фоне..." -ForegroundColor Yellow
Start-Process "wsl.exe" -ArgumentList "-d Ubuntu -u root -- bash -c ""systemctl start bookorbit.service; exec sleep infinity""" -WindowStyle Hidden

# 3. Ожидание готовности сервера (до 90 секунд для холодного старта PostgreSQL и NestJS)
Write-Host "[2/2] Ожидание готовности сервера ($url)..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($res.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {}
    Write-Host -NoNewline "."
}
Write-Host ""

if ($ready) {
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "BookOrbit успешно запущен и готов к работе!" -ForegroundColor Green
    Write-Host "Адрес: $url" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Start-Process $url
    Start-Sleep -Seconds 1
} else {
    Write-Host "Ошибка: веб-сервер не ответил в течение 90 секунд." -ForegroundColor Red
    Write-Host "Диагностика службы:" -ForegroundColor Yellow
    wsl.exe -d Ubuntu -u root -- systemctl status bookorbit.service --no-pager
    Write-Host "Нажмите любую клавишу для выхода..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}
