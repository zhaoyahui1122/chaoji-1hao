param(
  [string]$ApiBase = 'http://127.0.0.1:8012',
  [string]$WebBase = 'http://127.0.0.1:3002'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$runDir = Join-Path $PSScriptRoot '.run'

function Wait-HttpOk([string]$Url, [int]$Retries = 30) {
  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
        Write-Host "[quant-gate] OK $Url" -ForegroundColor Green
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "health check failed: $Url"
}

function Stop-WebInstance() {
  $webPidFile = Join-Path $runDir 'web.pid'
  if (Test-Path $webPidFile) {
    $targetPid = (Get-Content $webPidFile | Select-Object -First 1).Trim()
    if ($targetPid -match '^\d+$') {
      Write-Host "[quant-gate] stopping web pid=$targetPid" -ForegroundColor Yellow
      taskkill /PID $targetPid /F | Out-Null
    }
    Remove-Item -Force $webPidFile
  }

  $webPort = ([Uri]$WebBase).Port
  $lines = netstat -ano | Select-String ":$webPort\s+.*LISTENING"
  foreach ($line in $lines) {
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
    $targetPid = $parts[-1]
    if ($targetPid -match '^\d+$') {
      Write-Host "[quant-gate] killing residual web pid=$targetPid on port $webPort" -ForegroundColor Yellow
      taskkill /PID $targetPid /F | Out-Null
    }
  }
}

function Start-WebInstance() {
  $webUri = [Uri]$WebBase
  $cmd = "Set-Location '$PSScriptRoot'; & '.\start-web.ps1' -BindHost '$($webUri.Host)' -Port $($webUri.Port) -ApiBase '$ApiBase'"
  $proc = Start-Process powershell -ArgumentList '-NoLogo','-NoExit','-Command',$cmd -PassThru
  $proc.Id | Set-Content (Join-Path $runDir 'web.pid')
  Write-Host "[quant-gate] started web pid=$($proc.Id) $WebBase" -ForegroundColor Green
}

function Ensure-WebHealthy() {
  try {
    Wait-HttpOk $WebBase 3
  } catch {
    Write-Host '[quant-gate] web is unhealthy, restarting before verification...' -ForegroundColor Yellow
    Stop-WebInstance
    Start-WebInstance
    Wait-HttpOk $WebBase 30
  }
}

Wait-HttpOk "$ApiBase/health"
Ensure-WebHealthy

Stop-WebInstance

Write-Host '[quant-gate] building web...' -ForegroundColor Cyan
Set-Location (Join-Path $PSScriptRoot 'apps\web')
node node_modules\next\dist\bin\next build

Set-Location $PSScriptRoot
Start-WebInstance
Wait-HttpOk $WebBase

Write-Host '[quant-gate] running e2e...' -ForegroundColor Cyan
Set-Location (Join-Path $PSScriptRoot 'apps\web')
$env:PLAYWRIGHT_BASE_URL = $WebBase
npm run test:e2e
