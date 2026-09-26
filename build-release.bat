@echo off
title AeroPulse Widget - Building Release...
cd /d "%~dp0"

echo ====================================================
echo     DANG BUILD PHIEN BAN TOI UU (RELEASE MODE)
echo ====================================================
echo.
echo Qua trinh nay se toi uu LTO va strip ma nguon de app sieu nhe (~6MB-9MB)...
echo.

npm run tauri build

echo.
echo Build hoan tat! File chay nam tai:
echo src-tauri\target\release\widget-app.exe
pause
