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
  throw "The managed backend environment is missing. Run .\install-dev.ps1 -BackendPath '$BackendPath' first."
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

function Assert-BackendHealth {
  param(
    [string]$RuntimeStatusUrl,
    [string]$SupervisorHealthUrl
  )

  try {
    $runtime = Invoke-RestMethod -Uri $RuntimeStatusUrl -Method Get -TimeoutSec 5
  } catch {
    throw "Backend runtime health check failed at $RuntimeStatusUrl. $($_.Exception.Message)"
  }
  if ($null -eq $runtime.runtime_profile) {
    throw "The listener does not expose MoDiff's managed runtime profile. Stop the process and start the current backend."
  }
  if (-not [bool]$runtime.ready -or -not [bool]$runtime.runtime_profile.execution_ready) {
    $messages = @(
      $runtime.runtime_profile.issues |
        Where-Object { $null -ne $_.message } |
        ForEach-Object { [string]$_.message }
    )
    $detail = if ($messages.Count -gt 0) { $messages -join ' ' } else { 'The backend runtime is not ready.' }
    if ($runtime.runtime_profile.repair_command) {
      $detail = "$detail Repair: $($runtime.runtime_profile.repair_command)"
    }
    throw $detail
  }

  try {
    $supervisor = Invoke-RestMethod -Uri $SupervisorHealthUrl -Method Get -TimeoutSec 2
  } catch {
    throw "The listener does not expose MoDiff's process-external Stop/recovery control plane at $SupervisorHealthUrl. $($_.Exception.Message)"
  }
  if (-not [bool]$supervisor.ready -or -not [bool]$supervisor.workerRunning) {
    throw "The MoDiff backend supervisor is not ready. Restart the current backend."
  }
}

$frontendPath = Resolve-Path -LiteralPath $PSScriptRoot
$logDir = Join-Path $frontendPath "artifacts\dev-server-current"

if (-not (Test-Path -LiteralPath $BackendPath)) {
  throw "Backend path not found: $BackendPath"
}

$backendPathResolved = Resolve-Path -LiteralPath $BackendPath
$backendUrl = "http://127.0.0.1:$BackendPort"
$runtimeStatusUrl = "$backendUrl/runtime/status"
$supervisorHealthUrl = "http://127.0.0.1:$($BackendPort + 1)/health"
$frontendPortToUse = Get-AvailablePort -StartPort $FrontendPort
$frontendUrl = "http://127.0.0.1:$frontendPortToUse"

$backendPathEscaped = Escape-SingleQuotedString $backendPathResolved.Path
$frontendPathEscaped = Escape-SingleQuotedString $frontendPath.Path

if (Test-PortInUse -Port $BackendPort) {
  Write-Host "Backend port $BackendPort is already in use. Not starting another backend window." -ForegroundColor Yellow
  Assert-BackendHealth -RuntimeStatusUrl $runtimeStatusUrl -SupervisorHealthUrl $supervisorHealthUrl
} else {
  Invoke-BackendPreflight -BackendPath $backendPathResolved.Path -Port $BackendPort -LogDirectory $logDir

  $backendCommand = @"
`$Host.UI.RawUI.WindowTitle = 'MoDiff Backend'
Set-Location -LiteralPath '$backendPathEscaped'
`$env:PYTORCH_CUDA_ALLOC_CONF = if (`$env:PYTORCH_CUDA_ALLOC_CONF) { `$env:PYTORCH_CUDA_ALLOC_CONF } else { 'expandable_segments:True' }
if (Test-Path -LiteralPath '.\.venv\Scripts\python.exe') {
  & '.\.venv\Scripts\python.exe' main.py
} else {
  throw 'The managed backend environment is missing. Run the client install-dev.ps1 first.'
}
"@

  Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand)
  Write-Host "Started backend: $backendUrl" -ForegroundColor Green

  $deadline = (Get-Date).AddSeconds($BackendWaitSeconds)
  $backendReady = $false
  $lastBackendHealthError = $null
  while ((Get-Date) -lt $deadline) {
    if (Test-PortInUse -Port $BackendPort) {
      try {
        Assert-BackendHealth -RuntimeStatusUrl $runtimeStatusUrl -SupervisorHealthUrl $supervisorHealthUrl
        $backendReady = $true
        break
      } catch {
        $lastBackendHealthError = $_.Exception.Message
      }
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $backendReady) {
    $detail = if ($lastBackendHealthError) { " Last health error: $lastBackendHealthError" } else { '' }
    throw "Backend did not become ready on $backendUrl within $BackendWaitSeconds seconds.$detail Check the MoDiff Backend window for the Python error."
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
