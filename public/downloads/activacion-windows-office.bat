@echo off
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Solicitando permisos de administrador...
    powershell -Command "Start-Process cmd -ArgumentList '/c %~s0' -Verb runAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://get.activated.win | iex"
echo yata

pause