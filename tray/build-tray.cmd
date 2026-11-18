@echo off
setlocal
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "OUT=E:\Program Files\bookorbit\BookOrbitTray.exe"
set "SRC=E:\Program Files\bookorbit\tray\BookOrbitTray.cs"
set "ICON=E:\Program Files\bookorbit\bookorbit.ico"

"%CSC%" /nologo /target:winexe /optimize /platform:anycpu /out:"%OUT%" /win32icon:"%ICON%" /r:System.dll,System.Windows.Forms.dll,System.Drawing.dll,System.Core.dll "%SRC%"
if %ERRORLEVEL% EQU 0 (
    echo BookOrbitTray compiled successfully: %OUT%
) else (
    echo Compilation failed with code %ERRORLEVEL%
)
