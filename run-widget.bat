@echo off
cd /d "%~dp0"
if exist "widget-app.exe" (
    start "" "%~dp0widget-app.exe"
) else (
    echo Chua co widget-app.exe - hay chay build-release.bat truoc.
    pause
)
