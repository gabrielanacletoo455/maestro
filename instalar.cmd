@echo off
rem Instalador do Maestro para Windows: de dois cliques ou rode "instalar.cmd" no terminal.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
echo.
pause
