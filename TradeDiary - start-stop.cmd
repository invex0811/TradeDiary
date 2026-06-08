@echo off
set "PROJECT=C:\Users\ighor\Documents\TradeDiary"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT%\scripts\trade-diary-local.ps1"
timeout /t 4 /nobreak >nul
