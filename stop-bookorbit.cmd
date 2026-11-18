@echo off
chcp 65001 >nul
echo Остановка контейнеров BookOrbit...
wsl.exe -d Ubuntu -u root -- systemctl stop bookorbit.service
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Ошибка: Не удалось остановить службу BookOrbit (код ошибки: %ERRORLEVEL%).
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo Контейнеры BookOrbit успешно остановлены.
pause
