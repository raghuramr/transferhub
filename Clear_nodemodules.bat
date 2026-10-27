@echo off
setlocal enabledelayedexpansion
echo.
echo =================================================
echo   Deleting node_modules folders recursively
echo =================================================
echo.
set "count=0"
echo Searching and deleting 'node_modules' folders...
for /d /r . %%i in (node_modules) do (
    if exist "%%i" (
        rd /s /q "%%i" 2>nul && (
            echo   \[DELETED\] %%i
            set /a count+=1
        ) || echo   \[FAILED\] %%i (might be in use)
    )
)
echo.
echo =================================================
echo   Finished! Total folders deleted: %count%
echo =================================================
echo.
pause
