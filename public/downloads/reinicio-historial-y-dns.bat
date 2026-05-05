@echo off
title Limpieza completa de red WiFi
color 0A

echo =====================================
echo   LIMPIEZA Y REPARACION DE RED
echo =====================================
echo.

echo [1/6] Liberando IP...
ipconfig /release

echo [2/6] Renovando IP...
ipconfig /renew

echo [3/6] Limpiando cache DNS...
ipconfig /flushdns

echo [4/6] Reseteando Winsock...
netsh winsock reset

echo [5/6] Reseteando pila TCP/IP...
netsh int ip reset

echo [6/6] Limpiando configuracion WiFi...
netsh wlan delete profile name=* i=*

echo.
echo Generando reporte WLAN...
netsh wlan show wlanreport

echo.
echo =====================================
echo   PROCESO FINALIZADO
echo =====================================
echo.
echo IMPORTANTE: Reinicia la PC para aplicar todos los cambios.
pause