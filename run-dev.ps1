[CmdletBinding()]
param(
  [string]$BackendPath = '',
  [int]$BackendPort = 8088,
  [int]$FrontendPort = 5173,
  [int]$BackendWaitSeconds = 25,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

if (-not $BackendPath) {
  $canonicalBackendPath = Join-Path $PSScriptRoot '..\MoDiff'
  $lowercaseBackendPath = Join-Path $PSScriptRoot '..\modiff'
  $BackendPath = if (Test-Path $canonicalBackendPath) {
    $canonicalBackendPath
  } elseif (Test-Path $lowercaseBackendPath) {
    $lowercaseBackendPath
  } else {
    $canonicalBackendPath
  }
}

function Test-PortInUse {
  param([int]$Port)

  try {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Get-AvailablePort {
  param([int]$StartPort)

  for ($port = $StartPort; $port -lt ($StartPort + 30); $port += 1) {
    if (-not (Test-PortInUse -Port $port)) {
      return $port
    }
  }

  throw "Could not find a free frontend port starting at $StartPort."
}

function Escape-SingleQuotedString {
  param([string]$Value)
  return $Value -replace "'", "''"
}

function Get-BackendPythonInvocation {
  param([string]$BackendPath)

  $venvPython = Join-Path $BackendPath '.venv\Scripts\python.exe'
  if (Test-Path -LiteralPath $venvPython) {
    return @{
      File = $venvPython
      PrefixArgs = @()
    }
  }

  if (Get-Command uv -ErrorAction SilentlyContinue) {
    return @{
      File = "uv"
      PrefixArgs = @("run", "python")
    }
  }

  return @{
    File = "python"
    PrefixArgs = @()
  }
}

function Invoke-BackendPreflight {
  param(
    [string]$BackendPath,
    [int]$Port,
    [string]$LogDirectory
  )

  New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
  $stdoutFile = Join-Path $LogDirectory "backend-preflight.json"
  $stderrFile = Join-Path $LogDirectory "backend-preflight.err.log"
  $pythonInvocation = Get-BackendPythonInvocation -BackendPath $BackendPath
  $args = @($pythonInvocation.PrefixArgs + @("-m", "modiff.preflight", "--json", "--check-port", "$Port", "--fail-on-error"))

  $process = Start-Process `
    -FilePath $pythonInvocation.File `
    -ArgumentList $args `
    -WorkingDirectory $BackendPath `
    -WindowStyle Hidden `
    -Wait `
    -PassThru `
    -RedirectStandardOutput $stdoutFile `
    -RedirectStandardError $stderrFile

  if ($process.ExitCode -ne 0) {
    Write-Host "Backend preflight failed. Report: $stdoutFile" -ForegroundColor Red
    if (Test-Path -LiteralPath $stderrFile) {
      Get-Content -LiteralPath $stderrFile | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
    }
    if (Test-Path -LiteralPath $stdoutFile) {
      Get-Content -LiteralPath $stdoutFile | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    }
    throw "Fix the backend preflight errors before starting MoDiff."
  }

  $report = Get-Content -LiteralPath $stdoutFile -Raw | ConvertFrom-Json
  $torch = $report.packages.required | Where-Object { $_.module -eq "torch" } | Select-Object -First 1
  $cuda = if ($torch.cuda_available) { "CUDA ready: $($torch.cuda_device_name)" } else { "CUDA not available" }
  Write-Host "Backend preflight ready. Python $($report.python.versionInfo[0]).$($report.python.versionInfo[1]).$($report.python.versionInfo[2]); $cuda" -ForegroundColor Green
  Write-Host "Preflight report: $stdoutFile" -ForegroundColor DarkCyan
}

$frontendPath = Resolve-Path -LiteralPath $PSScriptRoot
$logDir = Join-Path $frontendPath "artifacts\dev-server-current"

if (-not (Test-Path -LiteralPath $BackendPath)) {
  throw "Backend path not found: $BackendPath"
}

$backendPathResolved = Resolve-Path -LiteralPath $BackendPath
$backendUrl = "http://127.0.0.1:$BackendPort"
$frontendPortToUse = Get-AvailablePort -StartPort $FrontendPort
$frontendUrl = "http://127.0.0.1:$frontendPortToUse"

$backendPathEscaped = Escape-SingleQuotedString $backendPathResolved.Path
$frontendPathEscaped = Escape-SingleQuotedString $frontendPath.Path

if (Test-PortInUse -Port $BackendPort) {
  Write-Host "Backend port $BackendPort is already in use. Not starting another backend window." -ForegroundColor Yellow
} else {
  Invoke-BackendPreflight -BackendPath $backendPathResolved.Path -Port $BackendPort -LogDirectory $logDir

  $backendCommand = @"
`$Host.UI.RawUI.WindowTitle = 'MoDiff Backend'
Set-Location -LiteralPath '$backendPathEscaped'
`$env:PYTORCH_CUDA_ALLOC_CONF = if (`$env:PYTORCH_CUDA_ALLOC_CONF) { `$env:PYTORCH_CUDA_ALLOC_CONF } else { 'expandable_segments:True' }
if (Test-Path -LiteralPath '.\.venv\Scripts\python.exe') {
  & '.\.venv\Scripts\python.exe' main.py
} elseif (Get-Command uv -ErrorAction SilentlyContinue) {
  & uv run main.py
} else {
  & python main.py
}
"@

  Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand)
  Write-Host "Started backend: $backendUrl" -ForegroundColor Green

  $deadline = (Get-Date).AddSeconds($BackendWaitSeconds)
  while ((Get-Date) -lt $deadline -and -not (Test-PortInUse -Port $BackendPort)) {
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-PortInUse -Port $BackendPort)) {
    Write-Host "Backend did not start listening on $backendUrl within $BackendWaitSeconds seconds." -ForegroundColor Red
    Write-Host "Check the MoDiff Backend window for the Python error, then install/fix backend dependencies." -ForegroundColor Yellow
  }
}

$frontendCommand = @"
`$Host.UI.RawUI.WindowTitle = 'MoDiff Frontend'
Set-Location -LiteralPath '$frontendPathEscaped'
Remove-Item Env:VITE_SERVER_ADDRESS -ErrorAction SilentlyContinue
`$env:VITE_BACKEND_PROXY_TARGET = '$backendUrl'
& npm.cmd run dev -- --host 127.0.0.1 --port $frontendPortToUse
"@

Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand)
Write-Host "Started frontend: $frontendUrl" -ForegroundColor Green
Write-Host "Frontend API target: $backendUrl through the Vite dev proxy" -ForegroundColor Cyan

if (-not $NoBrowser) {
  Start-Sleep -Seconds 2
  Start-Process $frontendUrl
}
