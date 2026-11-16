@echo off
chcp 65001 >nul
title Ortopoly online
cd /d "%~dp0"
if not exist "package.json" goto :noextraido
if not exist "scripts\online.mjs" goto :noextraido
where node >nul 2>nul
if errorlevel 1 goto :sinnode
if not exist "node_modules" (
  echo Instalando dependencias, es una sola vez...
  call npm install --omit=dev
  if errorlevel 1 goto :errorinstall
)
call npm run online
echo.
echo El juego se cerro. Si viste un error arriba, sacale una captura a esta ventana.
pause
exit /b 0

:noextraido
echo.
echo   No encuentro los archivos del juego al lado de este .bat.
echo.
echo   1. Cerra esta ventana.
echo   2. Busca ortopoly-v4.zip en Descargas, clic derecho y elegi "Extraer todo".
echo   3. Abri la carpeta que se crea y hace doble clic en JUGAR-ONLINE-Windows.bat
echo.
pause
exit /b 1

:sinnode
echo.
echo   Falta Node.js. Se abre la pagina: instala la version LTS,
echo   reinicia la compu y volve a abrir este archivo.
start https://nodejs.org
pause
exit /b 1

:errorinstall
echo.
echo   No se pudieron instalar las dependencias. Revisa tu conexion a internet
echo   y sacale una captura a esta ventana.
pause
exit /b 1
