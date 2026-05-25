param(
  [int]$ApiPort = 8012,
  [int]$WebPort = 3002
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$runDir = Join-Path $PSScriptRoot '.run'

function Stop-PidFile([string]$Name) {
  $path = Join-Path $runDir $Name
  if (Test-Path $path) {
    $targetPid = (Get-Content $path | Select-Object -First 1).Trim()
    if ($targetPid -match '^\d+$') {
      Write-Host "[quant-gate] stopping pid=$targetPid from $Name" -ForegroundColor Yellow
      taskkill /PID $targetPid /F | Out-Null
    }
    Remove-Item -Force $path
  }
}

function Stop-PortIfListening([int]$Port) {
  $lines = netstat -ano | Select-String ":$Port\s+.*LISTENING"
  foreach ($line in $lines) {
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
    $targetPid = $parts[-1]
    if ($targetPid -match '^\d+$') {
      Write-Host "[quant-gate] killing PID $targetPid on port $Port" -ForegroundColor Yellow
      taskkill /PID $targetPid /F | Out-Null
    }
  }
}

Stop-PidFile 'api.pid'
Stop-PidFile 'web.pid'
Stop-PortIfListening -Port $ApiPort
Stop-PortIfListening -Port $WebPort

Write-Host '[quant-gate] all dev services stopped' -ForegroundColor Green
