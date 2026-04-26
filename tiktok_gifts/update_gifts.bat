@echo off
setlocal
cd /d "%~dp0" || (echo [ERROR] cd failed & pause & exit /b 1)

set "TIKTOK_ID=%~1"
if "%TIKTOK_ID%"=="" set /p TIKTOK_ID=TikTokID:

if "%TIKTOK_ID%"=="" (
  echo [ERROR] TikTok ID is empty.
  pause
  exit /b 1
)

echo Updating gifts for %TIKTOK_ID% ...

node "tools\fetch_gifts.js" "%TIKTOK_ID%"
if errorlevel 1 (
  echo [ERROR] fetch_gifts failed.
  pause
  exit /b 1
)

node "tools\gifts_to_html.js"
if errorlevel 1 (
  echo [ERROR] gifts_to_html failed.
  pause
  exit /b 1
)

echo DONE!
start "" "%CD%\data\gifts"
pause