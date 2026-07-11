[CmdletBinding()]
param(
  [int]$BackendPort = 8088,
  [int]$FrontendPort = 5173,
  [int]$FrontendPortRange = 40,
  [switch]$SkipGpuCleanup,
  [switch]$StopAnyListener
)

$ErrorActionPreference = 'Stop'

function Get-ListenerProcess {
  param([int[]]$Ports)

  $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $Ports -contains $_.LocalPort } |
    Sort-Object LocalPort, OwningProcess -Unique

  foreach ($listener in $listeners) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $processInfo) {
      continue
    }

    [pscustomobject]@{
      Port = [int]$listener.LocalPort
      ProcessId = [int]$listener.OwningProcess
      Name = [string]$processInfo.Name
      CommandLine = [string]$processInfo.CommandLine
      ParentProcessId = [int]$processInfo.ParentProcessId
    }
  }
}

function Test-IsModiffDevProcess {
  param(
    [pscustomobject]$ProcessInfo,
    [int]$BackendPort,
    [int]$FrontendPort,
    [int]$FrontendPortRange
  )

  $commandLine = $ProcessInfo.CommandLine
  $name = $ProcessInfo.Name

  if ($ProcessInfo.Port -eq $BackendPort) {
    return ($name -match '^(python|python\.exe|uv|uv\.exe)$' -and $commandLine -match '(^|\s)main\.py(\s|$)')
  }

  $frontendEndPort = $FrontendPort + $FrontendPortRange
  if ($ProcessInfo.Port -ge $FrontendPort -and $ProcessInfo.Port -lt $frontendEndPort) {
    return ($name -match '^(node|node\.exe)$' -and $commandLine -match 'vite' -and $commandLine -match [regex]::Escape($PSScriptRoot))
  }

  return $false
}

function Stop-ListenerProcess {
  param([pscustomobject]$ProcessInfo)

  Write-Host "Stopping $($ProcessInfo.Name) PID $($ProcessInfo.ProcessId) on port $($ProcessInfo.Port)" -ForegroundColor Yellow
  Stop-Process -Id $ProcessInfo.ProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-GpuCleanup {
  param([int]$Port)

  $uri = "http://127.0.0.1:$Port/runtime/gpu_cleanup"
  try {
    $response = Invoke-RestMethod -Uri $uri -Method Post -TimeoutSec 15
    if ($response.message) {
      Write-Host $response.message -ForegroundColor DarkCyan
    }
  } catch {
    Write-Host "GPU cleanup request failed or backend is already stopping: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}

$frontendPorts = @()
for ($port = $FrontendPort; $port -lt ($FrontendPort + $FrontendPortRange); $port += 1) {
  $frontendPorts += $port
}
$targetPorts = @($BackendPort) + $frontendPorts

$listeners = @(Get-ListenerProcess -Ports $targetPorts)
if ($listeners.Count -eq 0) {
  Write-Host "No MoDiff dev listeners found on backend port $BackendPort or frontend ports $FrontendPort-$($FrontendPort + $FrontendPortRange - 1)." -ForegroundColor Green
  return
}

$targets = @($listeners | Where-Object {
  $StopAnyListener -or (Test-IsModiffDevProcess -ProcessInfo $_ -BackendPort $BackendPort -FrontendPort $FrontendPort -FrontendPortRange $FrontendPortRange)
})

$skipped = @($listeners | Where-Object { $targets.ProcessId -notcontains $_.ProcessId })
foreach ($item in $skipped) {
  Write-Host "Skipping PID $($item.ProcessId) on port $($item.Port); command line did not look like a MoDiff dev server. Use -StopAnyListener to stop it anyway." -ForegroundColor DarkYellow
}

if ($targets.Count -eq 0) {
  Write-Host "No matching MoDiff dev server processes to stop." -ForegroundColor Yellow
  return
}

if (-not $SkipGpuCleanup -and ($targets | Where-Object { $_.Port -eq $BackendPort })) {
  Invoke-GpuCleanup -Port $BackendPort
}

foreach ($target in $targets) {
  Stop-ListenerProcess -ProcessInfo $target
}

Start-Sleep -Milliseconds 500
$remaining = @(Get-ListenerProcess -Ports $targetPorts | Where-Object { $targets.ProcessId -contains $_.ProcessId })
if ($remaining.Count -gt 0) {
  foreach ($item in $remaining) {
    Write-Host "Still listening: PID $($item.ProcessId) on port $($item.Port)" -ForegroundColor Red
  }
  exit 1
}

Write-Host "MoDiff dev servers stopped." -ForegroundColor Green
