@echo off
setlocal enabledelayedexpansion

echo.
echo =================================================
echo   Deleting bin, obj, and .vs folders recursively
echo =================================================
echo.

set "count=0"

echo Searching and deleting 'bin' folders...
for /d /r . %%i in (bin) do (
    if exist "%%i" (
        rd /s /q "%%i" 2>nul && (
            echo   [DELETED] %%i
            set /a count+=1
        ) || echo   [FAILED] %%i (might be in use)
    )
)

echo.
echo Searching and deleting 'obj' folders...
for /d /r . %%i in (obj) do (
    if exist "%%i" (
        rd /s /q "%%i" 2>nul && (
            echo   [DELETED] %%i
            set /a count+=1
        ) || echo   [FAILED] %%i (might be in use)
    )
)

echo.
echo Searching and deleting '.vs' folders...
for /d /r . %%i in (.vs) do (
    if exist "%%i" (
        rd /s /q "%%i" 2>nul && (
            echo   [DELETED] %%i
            set /a count+=1
        ) || echo   [FAILED] %%i (might be in use)
    )
)

echo.
echo =================================================
echo   Finished! Total folders deleted: %count%
echo =================================================
echo.
pause