@echo off
chcp 65001 > nul
title MC TikTok Bridge

cd /d %~dp0

echo ===============================
echo  Bridge 起動
echo ===============================
echo.

node index.js --config config.minecraft.json

echo.
echo Bridge を終了しました。
pause
