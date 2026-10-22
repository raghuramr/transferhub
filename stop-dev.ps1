#Requires -Version 5.1
<#
.SYNOPSIS
    Stops the API and UI dev servers started by start-dev.ps1, by killing
    any node processes listening on their ports (3001 and 5173).

.EXAMPLE
    .\stop-dev.ps1
#>

$ports = 3001, 5173

foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "Nothing listening on port $port" -ForegroundColor Yellow
        continue
    }
    foreach ($conn in $conns) {
        $procId = $conn.OwningProcess
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Stopping port $port -> $($proc.ProcessName) (PID $procId)" -ForegroundColor Cyan
            Stop-Process -Id $procId -Force
        }
    }
}

Write-Host "Done. You can also just close the API/UI PowerShell windows directly." -ForegroundColor Green
