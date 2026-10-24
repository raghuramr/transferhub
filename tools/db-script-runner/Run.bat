@echo off
REM Double-click launcher for DbScriptRunner.ps1.
REM Uses -ExecutionPolicy Bypass for THIS invocation only — it does not
REM change your machine's global PowerShell execution policy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DbScriptRunner.ps1"
