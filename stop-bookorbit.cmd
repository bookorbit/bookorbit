@echo off
chcp 65001 >nul
echo Остановка контейнеров BookOrbit через Kiri...
wsl bash -c "cd '/mnt/e/Program Files/bookorbit' && docker compose down"
echo.
echo Контейнеры остановлены.
pause
