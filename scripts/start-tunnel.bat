@echo off
cd /d "%~dp0\.."

:retry
echo Iniciando localtunnel en https://techasset-nfpt.loca.lt
npx localtunnel --local-host 127.0.0.1 --port 8000 --subdomain techasset-nfpt
echo.
echo localtunnel se cerro o no concedio el subdominio. Reintentando en 5 seg...
timeout /t 5 /nobreak >nul
goto retry
