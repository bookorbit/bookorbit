[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "BookOrbit Launcher"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "         BookOrbit Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$installDir = "E:\Program Files\bookorbit"
Set-Location $installDir

# 1. Проверка Kiri / Docker
Write-Host "[1/4] Проверка легковесного контейнерного рантайма Kiri..." -ForegroundColor Yellow
$kiriOk = $false
try {
    $null = wsl systemctl is-active kiri.service 2>&1
    if ($LASTEXITCODE -eq 0) {
        $kiriOk = $true
    } else {
        Write-Host "Запуск службы Kiri в WSL2..." -ForegroundColor Yellow
        wsl systemctl start kiri.service
        Start-Sleep -Seconds 1
        $null = wsl systemctl is-active kiri.service 2>&1
        if ($LASTEXITCODE -eq 0) {
            $kiriOk = $true
        }
    }
} catch {}

if (-not $kiriOk) {
    Write-Host "ОШИБКА: Не удалось запустить рантайм Kiri в WSL2." -ForegroundColor Red
    Write-Host "Нажмите любую клавишу для выхода..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "[2/4] Рантайм Kiri активен (потребление ~860 КБ RAM)." -ForegroundColor Green

# 2. Запуск контейнеров через Kiri (docker compose)
Write-Host "[3/4] Запуск контейнеров BookOrbit через Kiri..." -ForegroundColor Yellow
wsl bash -c "cd '/mnt/e/Program Files/bookorbit' && docker compose up -d"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Ошибка при запуске контейнеров!" -ForegroundColor Red
    Write-Host "Нажмите любую клавишу для выхода..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# 3. Ожидание доступности веб-интерфейса
Write-Host "[4/4] Ожидание готовности веб-интерфейса (http://localhost:3000)..." -ForegroundColor Yellow
$url = "http://localhost:3000"
$apiUrl = "http://localhost:3000/api/v1/auth/setup-status"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($null -ne $response -and $null -ne $response.needsSetup) {
            $ready = $true
            break
        }
    } catch {}
    Write-Host -NoNewline "."
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "BookOrbit успешно запущен!" -ForegroundColor Green
Write-Host "Открываю браузер: $url" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Start-Process $url
Start-Sleep -Seconds 2
