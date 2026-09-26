@echo off
title AeroPulse Widget - Launching...
cd /d "%~dp0"

echo ====================================================
echo           AEROPULSE SYSTEM WIDGET (TAURI V2)
echo ====================================================
echo.
echo Dang khoi dong Widget o goc tren ben phai man hinh...
echo.

if exist "widget-app.exe" (
    start "" "%~dp0widget-app.exe"
    exit
) else if exist "src-tauri\target\debug\widget-app.exe" (
    start "" "%~dp0src-tauri\target\debug\widget-app.exe"
    exit
) else (
    echo Chua tim thay file build san, dang khoi chay bang cargo...
    cd src-tauri
    cargo run
)
