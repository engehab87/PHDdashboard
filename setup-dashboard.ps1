#Requires -Version 5.1
<#
.SYNOPSIS
    Palm Hills HCP Dashboard — Laptop Setup Script (Windows)

.DESCRIPTION
    Prepares your Windows laptop to run the Palm Hills Community Operations
    Intelligence Platform backend and reach the site HCP server through the
    FortiClient VPN profile already configured on this machine.

    Based on HCP Integration API Specs (Oct 2026):
      - Node.js v24 + Express 4 + SQLite + SheetJS
      - Backend port 2020
      - FortiClient CLI control (optional)
      - AES-256-GCM credential vault (HCP_VAULT_KEY)

.NOTES
    Run from an elevated PowerShell prompt if you need to write to
    Program Files or change system PATH. Normal user elevation is enough
    for most steps.
#>

param(
    [string]$ProjectRoot   = (Get-Location).Path,
    [string]$Port          = "2020",
    [string]$DbPath        = "data\app.db",
    [string]$FortiCliPath  = "C:\Program Files\Fortinet\FortiClient\forticli.exe",
    [string]$FortiTunnel   = "PHNC-Tunnel",
    [switch]$EnableVpnControl,
    [switch]$SkipNpmInstall,
    [switch]$StartServer
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "    [X]  $msg" -ForegroundColor Red }

function Test-CommandExists {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function New-VaultKey {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ([BitConverter]::ToString($bytes) -replace '-','').ToLowerInvariant()
}

# ---------------------------------------------------------------------------
# 1. Project root
# ---------------------------------------------------------------------------
Write-Step "Project root: $ProjectRoot"
if (-not (Test-Path $ProjectRoot)) {
    New-Item -ItemType Directory -Path $ProjectRoot | Out-Null
    Write-Ok "Created project directory"
}
Set-Location $ProjectRoot

# ---------------------------------------------------------------------------
# 2. Node.js check
# ---------------------------------------------------------------------------
Write-Step "Checking Node.js"
if (-not (Test-CommandExists "node")) {
    Write-Fail "Node.js is not installed or not on PATH."
    Write-Host @"
    Install Node.js 24.x from https://nodejs.org/
    Then re-run this script.
"@
    exit 1
}

$nodeVer = (node -v).TrimStart('v')
Write-Ok "Found Node.js $nodeVer"

$major = [int]($nodeVer.Split('.')[0])
if ($major -lt 20) {
    Write-Warn "Recommended version is Node.js 24.x (spec). You have $nodeVer. Continuing anyway."
}

if (-not (Test-CommandExists "npm")) {
    Write-Fail "npm not found. Re-install Node.js with npm included."
    exit 1
}
Write-Ok "npm $((npm -v))"

# ---------------------------------------------------------------------------
# 3. Data directory
# ---------------------------------------------------------------------------
Write-Step "Creating data directory"
$dataDir = Join-Path $ProjectRoot "data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir | Out-Null
    Write-Ok "Created $dataDir"
} else {
    Write-Ok "Data directory already exists"
}

# ---------------------------------------------------------------------------
# 4. Environment file (.env)
# ---------------------------------------------------------------------------
Write-Step "Preparing .env file"
$envPath = Join-Path $ProjectRoot ".env"
$vaultKey = $null
$existingEnv = @{}

if (Test-Path $envPath) {
    Write-Ok ".env already exists — will preserve existing values and only fill missing keys"
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $existingEnv[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    if ($existingEnv.ContainsKey("HCP_VAULT_KEY") -and $existingEnv["HCP_VAULT_KEY"] -ne "") {
        $vaultKey = $existingEnv["HCP_VAULT_KEY"]
        Write-Ok "Re-using existing HCP_VAULT_KEY"
    }
}

if (-not $vaultKey) {
    $vaultKey = New-VaultKey
    Write-Ok "Generated new HCP_VAULT_KEY (keep this secret!)"
}

$vpnEnabled = if ($EnableVpnControl) { "true" } else { "false" }

# Prefer values already present; otherwise use script defaults / generated
function Get-EnvVal($key, $default) {
    if ($existingEnv.ContainsKey($key) -and $existingEnv[$key] -ne "") {
        return $existingEnv[$key]
    }
    return $default
}

$envContent = @"
# ---------------------------------------------------------------------------
# Palm Hills HCP Dashboard — Environment (generated $(Get-Date -Format 'yyyy-MM-dd HH:mm'))
# ---------------------------------------------------------------------------

# REQUIRED: 64-hex AES-256-GCM key for encrypting app_secret / vpn_password
# Changing this key orphans previously stored secrets — you must re-enter them.
HCP_VAULT_KEY=$(Get-EnvVal "HCP_VAULT_KEY" $vaultKey)

# Backend
PORT=$(Get-EnvVal "PORT" $Port)
DB_PATH=$(Get-EnvVal "DB_PATH" $DbPath)

# FortiClient VPN control (disabled by default — safer for first runs)
# Set FORTICLIENT_ENABLED=true only after the CLI path and tunnel name are verified.
FORTICLIENT_ENABLED=$(Get-EnvVal "FORTICLIENT_ENABLED" $vpnEnabled)
FORTICLIENT_CLI=$(Get-EnvVal "FORTICLIENT_CLI" $FortiCliPath)
FORTICLIENT_TUNNEL=$(Get-EnvVal "FORTICLIENT_TUNNEL" $FortiTunnel)

# Health-check interval (ms). 0 disables the periodic checker.
HCP_HEALTHCHECK_MS=$(Get-EnvVal "HCP_HEALTHCHECK_MS" "300000")

# Optional: force Node to treat the project as ES modules / CommonJS as needed
# NODE_OPTIONS=
"@

Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Ok "Wrote $envPath"

# ---------------------------------------------------------------------------
# 5. FortiClient presence check
# ---------------------------------------------------------------------------
Write-Step "Checking FortiClient CLI"
$cli = Get-EnvVal "FORTICLIENT_CLI" $FortiCliPath
if (Test-Path $cli) {
    Write-Ok "Found forticli.exe at $cli"
    try {
        $statusOut = & $cli -vpnstatus 2>&1 | Out-String
        Write-Host "    Current VPN status output:" -ForegroundColor DarkGray
        $statusOut -split "`n" | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    } catch {
        Write-Warn "Could not run -vpnstatus (may need elevation or different CLI version)"
    }
} else {
    Write-Warn "forticli.exe not found at: $cli"
    Write-Host @"
    The backend can still run. Connect the VPN manually with the FortiClient GUI
    before starting a sync. Update FORTICLIENT_CLI in .env once you locate the binary.
"@
}

# ---------------------------------------------------------------------------
# 6. package.json / npm install
# ---------------------------------------------------------------------------
Write-Step "Dependencies"
$pkgPath = Join-Path $ProjectRoot "package.json"
if (Test-Path $pkgPath) {
    if (-not $SkipNpmInstall) {
        Write-Host "    Running npm install ..."
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "npm install failed"
            exit 1
        }
        Write-Ok "npm install completed"
    } else {
        Write-Ok "Skipped npm install (--SkipNpmInstall)"
    }
} else {
    Write-Warn "No package.json found in $ProjectRoot"
    Write-Host @"
    Place this script inside the real project root (the folder that contains
    backend/, package.json, etc.) and re-run, or run 'npm install' manually
    after you have the source tree.
"@
}

# ---------------------------------------------------------------------------
# 7. Quick connectivity reminder
# ---------------------------------------------------------------------------
Write-Step "Next steps (manual)"
Write-Host @"

  1. Connect FortiClient tunnel manually (recommended for first runs)
       Open FortiClient → select the profile that already works → Connect.
       Confirm you can reach the HCP host (e.g. ping 192.168.x.x or
       open https://<hcp-host> in a browser).

  2. Start the backend (from project root):
       npm start
       # or:  node backend/server.js   (adjust to actual entry point)
       # or:  .\setup-dashboard.ps1 -StartServer

  3. Open the dashboard UI (if served by the same process or by Apache/XAMPP)
       http://localhost:2020   or   http://localhost

  4. Create / configure a compound:
       - host / port / HTTPS
       - hcp_version = 2.6.0
       - openapi_version = 2.6
       - app_key + app_secret
       - camera_index_code (required for vehicle events)

  5. Run the 9-stage diagnostic:
       POST /api/hcp/compounds/:id/test
       then poll GET /api/hcp/runs/:runId

  6. Only after the diagnostic is green and the adapter is verified,
     start a sync:  POST /api/hcp/compounds/:id/sync

  IMPORTANT current blockers (from the API spec):
    • Adapter hcp-artemis-v26 is still verified:false → sync gate blocks live sync
    • TLS cert on the HCP host may have CN=127.0.0.1 — pin a CA or ask IT to re-issue
    • cameraIndexCode must be set for vehicle / access-event categories

"@

# ---------------------------------------------------------------------------
# 8. Optional: start server
# ---------------------------------------------------------------------------
if ($StartServer) {
    Write-Step "Starting backend server on port $Port"
    if (Test-Path (Join-Path $ProjectRoot "package.json")) {
        # Prefer npm start if a start script exists
        $pkg = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
        if ($pkg.scripts -and $pkg.scripts.start) {
            npm start
        } else {
            Write-Warn "No 'start' script in package.json. Looking for common entry points..."
            $candidates = @(
                "backend\server.js",
                "backend\index.js",
                "src\server.js",
                "server.js",
                "index.js"
            )
            $found = $null
            foreach ($c in $candidates) {
                $full = Join-Path $ProjectRoot $c
                if (Test-Path $full) { $found = $full; break }
            }
            if ($found) {
                Write-Ok "Launching node $found"
                node $found
            } else {
                Write-Fail "Could not locate server entry point. Start it manually."
            }
        }
    } else {
        Write-Fail "No package.json — cannot auto-start. Place the script in the real project root."
    }
}

Write-Host "`nSetup finished." -ForegroundColor Green
