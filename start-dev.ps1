param(
  [string]$ApiHost = '127.0.0.1',
  [int]$ApiPort = 8012,
  [string]$WebHost = '127.0.0.1',
  [int]$WebPort = 3002,
  [switch]$CleanWebCache
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$runDir = Join-Path $PSScriptRoot '.run'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

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

Stop-PortIfListening -Port $ApiPort
Stop-PortIfListening -Port $WebPort

if ($CleanWebCache) {
  $nextDir = Join-Path $PSScriptRoot 'apps\web\.next'
  if (Test-Path $nextDir) {
    Write-Host '[quant-gate] clearing apps/web/.next' -ForegroundColor Yellow
    Remove-Item -Recurse -Force $nextDir
  }
}

$apiCmd = "Set-Location '$PSScriptRoot'; & '.\start-api.ps1' -BindHost '$ApiHost' -Port $ApiPort"
$apiProc = Start-Process powershell -ArgumentList '-NoLogo','-NoExit','-Command',$apiCmd -PassThru
$apiProc.Id | Set-Content (Join-Path $runDir 'api.pid')
Write-Host "[quant-gate] API started pid=$($apiProc.Id) http://$ApiHost`:$ApiPort" -ForegroundColor Green

Start-Sleep -Seconds 2

$apiBase = "http://$ApiHost`:$ApiPort"
$webCmd = "Set-Location '$PSScriptRoot'; & '.\start-web.ps1' -BindHost '$WebHost' -Port $WebPort -ApiBase '$apiBase'"
$webProc = Start-Process powershell -ArgumentList '-NoLogo','-NoExit','-Command',$webCmd -PassThru
$webProc.Id | Set-Content (Join-Path $runDir 'web.pid')
Write-Host "[quant-gate] WEB started pid=$($webProc.Id) http://$WebHost`:$WebPort" -ForegroundColor Green

Write-Host ''
Write-Host '[quant-gate] done' -ForegroundColor Green
Write-Host "  API: $apiBase/health"
Write-Host "  WEB: http://$WebHost`:$WebPort"
Write-Host '  Stop: .\stop-dev.ps1'
Write-Host '  Test: .\test-dev.ps1'
