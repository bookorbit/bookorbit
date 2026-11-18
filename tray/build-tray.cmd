@echo off
chcp 65001 >nul
echo [BookOrbit] Компиляция нативного Windows Tray...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize /platform:anycpu /out:"%~dp0..\BookOrbitTray.exe" /win32icon:"%~dp0..\bookorbit.ico" /r:System.dll,System.Windows.Forms.dll,System.Drawing.dll,System.Core.dll "%~dp0BookOrbitTray.cs"
if %ERRORLEVEL% EQU 0 (
    echo [BookOrbit] Сборка успешно завершена: BookOrbitTray.exe
) else (
    echo [BookOrbit] Ошибка при компиляции!
)
