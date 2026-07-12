param(
  [string]$BackendPath = (Join-Path $PSScriptRoot "..\MoDiff"),
  [ValidateSet("auto", "nvidia", "amd", "mps", "cpu")][string]$Accelerator = "auto",
  [switch]$AllowExperimental, [switch]$Resume, [switch]$Repair
)
$ErrorActionPreference = "Stop"
$installer = Join-Path $BackendPath "install.ps1"
if (!(Test-Path $installer)) { throw "MoDiff backend installer not found at $installer" }
& $installer -Accelerator $Accelerator -AllowExperimental:$AllowExperimental -Resume:$Resume -Repair:$Repair
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Set-Location $PSScriptRoot
npm ci
$artifactDir = Join-Path $PSScriptRoot "artifacts\dev-install-current"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$python = Join-Path $BackendPath ".venv\Scripts\python.exe"
& $python -m modiff.preflight --json --fail-on-error | Set-Content (Join-Path $artifactDir "backend-preflight.json")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Development environment is ready. Run .\run-dev.ps1."
