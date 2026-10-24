@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\jszip\" (
  call npm install --no-audit --no-fund
)
node scripts\publish.mjs
echo.
pause
