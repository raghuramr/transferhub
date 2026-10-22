#Requires -Version 5.1
<#
.SYNOPSIS
    Starts the API (NestJS) and UI (Vite/React) dev servers together, each in
    its own PowerShell window, so you don't have to run them in two terminals
    by hand.

.DESCRIPTION
    - Verifies Node/npm are available
    - Installs npm dependencies for src/api and src/ui if node_modules is missing
    - Optionally seeds demo user passwords first (-Seed)
    - Launches:
        API  -> http://localhost:3001/api   (new window)
        UI   -> http://localhost:5173       (new window)
    - Opens the UI in your default browser once it's likely up

.PARAMETER Seed
    Run "npm run seed:users" in src/api before starting the servers.

.PARAMETER SkipInstall
    Skip the npm install step even if node_modules is missing.

.PARAMETER NoBrowser
    Don't automatically open the UI in a browser.

.EXAMPLE
    .\start-dev.ps1

.EXAMPLE
    .\start-dev.ps1 -Seed

.NOTES
    If PowerShell blocks this script from running, use:
        powershell -ExecutionPolicy Bypass -File start-dev.ps1
#>

param(
    [switch]$Seed,
    [switch]$SkipInstall,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root    = $PSScriptRoot
$apiDir  = Join-Path $root 'src\api'
$uiDir   = Join-Path $root 'src\ui'
$apiUrl  = 'http://localhost:3001/api'
$uiUrl   = 'http://localhost:5173'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    $msg" -ForegroundColor Red }

# --- 1. Sanity checks -----------------------------------------
Write-Step 'Checking prerequisites'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err 'Node.js is not on PATH. Install it from https://nodejs.org and try again.'
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Err 'npm is not on PATH (usually ships with Node.js).'
    exit 1
}

if (-not (Test-Path $apiDir)) { Write-Err "API folder not found: $apiDir"; exit 1 }
if (-not (Test-Path $uiDir))  { Write-Err "UI folder not found: $uiDir";   exit 1 }

Write-Ok "Node:  $(node --version)"
Write-Ok "npm:   $(npm --version)"

# --- 2. .env check ----------------------------------------------
$apiEnv = Join-Path $apiDir '.env'
if (-not (Test-Path $apiEnv)) {
    Write-Step 'Creating src/api/.env from .env.example'
    Push-Location $apiDir
    npm run setup:env
    Pop-Location
    Write-Warn 'Review src/api/.env (DB_SERVER, DB_ODBC_DRIVER, JWT_SECRET, ANTHROPIC_API_KEY) before continuing.'
}

# --- 3. Install dependencies if missing --------------------------
if (-not $SkipInstall) {
    if (-not (Test-Path (Join-Path $apiDir 'node_modules'))) {
        Write-Step 'Installing API dependencies (npm install)'
        Push-Location $apiDir
        npm install
        Pop-Location
    } else {
        Write-Ok 'API dependencies already installed'
    }

    if (-not (Test-Path (Join-Path $uiDir 'node_modules'))) {
        Write-Step 'Installing UI dependencies (npm install)'
        Push-Location $uiDir
        npm install
        Pop-Location
    } else {
        Write-Ok 'UI dependencies already installed'
    }
}

# --- 4. Optional: seed demo user passwords -----------------------
if ($Seed) {
    Write-Step 'Seeding demo user passwords (npm run seed:users)'
    Push-Location $apiDir
    npm run seed:users
    Pop-Location
}

# --- 5. Launch API and UI, each in its own window -----------------
Write-Step 'Starting API dev server'
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$apiDir'; Write-Host 'API -> $apiUrl' -ForegroundColor Cyan; npm run start:dev"
) -WindowStyle Normal
Write-Ok "API window launched ($apiUrl)"

Write-Step 'Starting UI dev server'
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$uiDir'; Write-Host 'UI -> $uiUrl' -ForegroundColor Cyan; npm run dev"
) -WindowStyle Normal
Write-Ok "UI window launched ($uiUrl)"

# --- 6. Open browser once the UI is likely ready ------------------
if (-not $NoBrowser) {
    Write-Step 'Waiting for the UI dev server to come up...'
    $maxWaitSeconds = 30
    $ready = $false
    for ($i = 0; $i -lt $maxWaitSeconds; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-WebRequest -Uri $uiUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
    }
    if ($ready) {
        Write-Ok 'UI is up - opening browser'
        Start-Process $uiUrl
    } else {
        Write-Warn "UI didn't respond within $maxWaitSeconds seconds - check its window for errors. You can open $uiUrl manually."
    }
}

Write-Host "`nBoth servers are running in their own windows." -ForegroundColor Cyan
Write-Host "Close those windows (or Ctrl+C inside them) to stop the API/UI." -ForegroundColor Cyan
Write-Host "API: $apiUrl"
Write-Host "UI:  $uiUrl"
