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
Write-Host "Installation complete. Starting the application..." -ForegroundColor Green
npm.cmd start
