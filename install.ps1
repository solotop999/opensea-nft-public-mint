$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Test-NodeVersion {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
    $major = [int]((node --version).TrimStart('v').Split('.')[0])
    return $major -ge 18
}

Write-Host "NFT Public Mint - Windows installer" -ForegroundColor Cyan
if (-not (Test-NodeVersion)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Node.js 18+ is required. Install it from https://nodejs.org and run this script again."
    }
    Write-Host "Installing the latest Node.js LTS with winget..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget failed with exit code $LASTEXITCODE." }
    $nodeDirectory = Join-Path $env:ProgramFiles "nodejs"
    if (Test-Path -LiteralPath $nodeDirectory) { $env:Path = "$nodeDirectory;$env:Path" }
}
if (-not (Test-NodeVersion)) {
    throw "Node.js 18+ was not found. Open a new PowerShell window and run install.ps1 again."
}

Write-Host "Using Node.js $(node --version) and npm $(npm --version)" -ForegroundColor Green
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
    Write-Host "Created .env from .env.example (optional settings only)." -ForegroundColor Yellow
}

$envText = [System.IO.File]::ReadAllText((Resolve-Path ".env"))
if ($envText -match '(?m)^OPENSEA_API_KEY=\s*$') {
    Write-Host "Requesting a free OpenSea API key..." -ForegroundColor Cyan
    try {
        $keyResponse = Invoke-RestMethod -Method Post -Uri "https://api.opensea.io/api/v2/auth/keys"
        $openSeaKey = [string]$keyResponse.api_key
        if ([string]::IsNullOrWhiteSpace($openSeaKey)) { throw "Missing api_key in response." }
        $envText = [regex]::Replace($envText, '(?m)^OPENSEA_API_KEY=\s*$', "OPENSEA_API_KEY=$openSeaKey")
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Resolve-Path ".env"), $envText, $utf8NoBom)
        Write-Host "OpenSea API key saved to .env (key hidden)." -ForegroundColor Green
    } catch {
        Write-Host "Could not create an OpenSea API key. Paste your existing key into OPENSEA_API_KEY in .env." -ForegroundColor Yellow
    }
}

Write-Host "Installation complete. Starting the application..." -ForegroundColor Green
npm.cmd start
