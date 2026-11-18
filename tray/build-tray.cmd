@echo off
setlocal
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
set "OUT=%~dp0..\BookOrbitTray.exe"
set "SRC=%~dp0BookOrbitTray.cs"
set "ICON=%~dp0..\bookorbit.ico"

"%CSC%" /nologo /target:winexe /optimize /platform:anycpu /out:"%OUT%" /win32icon:"%ICON%" /r:System.dll,System.Windows.Forms.dll,System.Drawing.dll,System.Core.dll "%SRC%"
if %ERRORLEVEL% EQU 0 (
    echo BookOrbitTray compiled successfully: %OUT%
) else (
    echo Compilation failed with code %ERRORLEVEL%
)
