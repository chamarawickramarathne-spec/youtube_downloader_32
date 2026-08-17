@echo off
echo ===================================
echo  YouTube Fetcher - Build Script
echo ===================================
echo.

set PYTHON=C:\Users\Nwick\AppData\Local\Programs\Python\Python312-32\python.exe
set PYINSTALLER=C:\Users\Nwick\AppData\Local\Programs\Python\Python312-32\Scripts\pyinstaller.exe

echo [1/3] Installing dependencies...
%PYTHON% -m pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo FAILED: Could not install dependencies
    pause
    exit /b 1
)
echo.

echo [2/3] Cleaning previous build...
if exist "dist" rmdir /s /q "dist"
if exist "build" rmdir /s /q "build"
echo.

echo [3/3] Building executable...
%PYINSTALLER% --noconfirm --onefile --windowed ^
    --name "YouTubeFetcher" ^
    --add-data "web;web" ^
    --add-data "resources;resources" ^
    --hidden-import webview ^
    --hidden-import webview.platforms ^
    --hidden-import webview.platforms.winforms ^
    --hidden-import pythonnet ^
    --hidden-import clr_loader ^
    --hidden-import bottle ^
    --hidden-import proxy_tools ^
    --hidden-import pyperclip ^
    --clean ^
    main.py

if %ERRORLEVEL% neq 0 (
    echo FAILED: Build failed
    pause
    exit /b 1
)

echo.
echo ===================================
echo  BUILD SUCCESSFUL
echo  Output: dist\YouTubeFetcher.exe
echo ===================================
pause
