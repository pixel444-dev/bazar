@echo off
chcp 65001 >nul
title Central do Bazar
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado neste computador.
  echo Instale a versao LTS de https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install --omit=dev
)
node --disable-warning=ExperimentalWarning server.js
pause
