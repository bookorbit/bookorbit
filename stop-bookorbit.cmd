@echo off
chcp 65001 >nul
echo Остановка контейнеров BookOrbit...
wsl.exe -d Ubuntu -u root -- systemctl stop bookorbit.service
echo.
echo Контейнеры BookOrbit успешно остановлены.
pause
