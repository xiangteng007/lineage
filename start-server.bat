@echo off
title Lineage AI Server - localhost:3001
cd /d "%~dp0"
echo.
echo  ==========================================
echo   Lineage AI - 天堂：經典版 管理系統
echo   伺服器啟動中...  http://localhost:3001
echo  ==========================================
echo.
node server.js
pause
