@echo off
cd /d "%~dp0\.."
if not exist backups mkdir backups
copy data\techasset.db backups\techasset-%date:~-4%%date:~3,2%%date:~0,2%-%time:~0,2%%time:~3,2%.db
