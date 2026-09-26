@echo off
title AeroPulse Widget - Building Release...
cd /d "%~dp0src-tauri"

echo ====================================================
echo     BUILD BAN RELEASE (toolchain Rust GNU + WinLibs)
echo ====================================================
echo.

rem May khong co Visual Studio Build Tools -> dung toolchain GNU cua Rust + MinGW (WinLibs)
for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\BrechtSanders.WinLibs*") do set "MINGW_BIN=%%D\mingw64\bin"
if not defined MINGW_BIN (
    echo Khong tim thay WinLibs. Cai bang lenh:
    echo   winget install BrechtSanders.WinLibs.POSIX.UCRT
    pause
    exit /b 1
)
set "PATH=%MINGW_BIN%;%PATH%"

taskkill /im widget-app.exe /f >nul 2>&1
cargo +stable-x86_64-pc-windows-gnu build --release || (pause & exit /b 1)
copy /y "target\release\widget-app.exe" "..\widget-app.exe" >nul

rem Thu muc target nang ~1-2 GB, chi can khi build -> xoa sau khi da copy exe ra ngoai
cargo clean >nul 2>&1

echo.
echo Build hoan tat: widget-app.exe
pause
