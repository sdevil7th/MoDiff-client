param(
  [string]$BackendPath = (Join-Path $PSScriptRoot "..\MoDiff"),
  [ValidateSet("auto", "nvidia", "amd", "intel", "mps", "cpu")][string]$Accelerator = "auto",
  [switch]$AllowExperimental, [switch]$Resume, [switch]$Repair
)
$ErrorActionPreference = "Stop"
$BackendPath = (Resolve-Path -LiteralPath $BackendPath).ProviderPath
$installer = Join-Path $BackendPath "install.ps1"
if (!(Test-Path $installer)) { throw "MoDiff backend installer not found at $installer" }
& $installer -Accelerator $Accelerator -AllowExperimental:$AllowExperimental -Resume:$Resume -Repair:$Repair -BackendOnly
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$python = Join-Path $BackendPath ".venv\Scripts\python.exe"
$testRequirements = Join-Path $BackendPath "requirements\test.txt"
Push-Location -LiteralPath $BackendPath
try {
  $uv = & $python -c "from pathlib import Path; from modiff.tool_locks import resolve_uv; print(resolve_uv(Path('.modiff')))"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
& $uv pip install --python $python -r $testRequirements
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location $PSScriptRoot
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$artifactDir = Join-Path $PSScriptRoot "artifacts\dev-install-current"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
& $python -m modiff.preflight --json --fail-on-error | Set-Content (Join-Path $artifactDir "backend-preflight.json")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Development environment is ready. Run .\run-dev.ps1."
