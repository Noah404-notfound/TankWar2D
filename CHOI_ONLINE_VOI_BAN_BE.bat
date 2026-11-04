@echo off
chcp 65001 >nul
title TankWar - Tao Link Choi Online Khac Mang LAN
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0share-online.ps1"
pause

