param(
  [string]$ApiBase = 'http://127.0.0.1:8012',
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 3005,
  [string[]]$TestFiles = @('tests/e2e.spec.ts', 'tests/paper-live.spec.ts')
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$webDir = Join-Path $root 'apps\web'

function Wait-HttpReady {
  param(
    [string]$Url,
    [int]$MaxAttempts = 30,
    [int]$DelaySeconds = 1
  )

  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -eq 200 -and $resp.Content -match 'Quant Gate MVP') {
        Write-Host "[quant-gate] ready => $Url" -ForegroundColor Green
        return
      }
      Write-Host "[quant-gate] probe[$i] => status=$($resp.StatusCode)" -ForegroundColor Yellow
    } catch {
      Write-Host "[quant-gate] probe[$i] => $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
    Start-Sleep -Seconds $DelaySeconds
  }

  throw "web not ready: $Url"
}

Write-Host "[quant-gate] production regression => start" -ForegroundColor Cyan

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  $pids = $existing | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pid in $pids) {
    Write-Host "[quant-gate] kill existing listener pid=$pid on port $Port" -ForegroundColor Yellow
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}

$startArgs = @(
  '-ExecutionPolicy', 'Bypass',
  '-File', (Join-Path $root 'start-web.ps1'),
  '-Production',
  '-BindHost', $BindHost,
  '-Port', $Port,
  '-ApiBase', $ApiBase
)

$proc = Start-Process -FilePath 'powershell' -ArgumentList $startArgs -WorkingDirectory $root -PassThru
try {
  Wait-HttpReady -Url "http://${BindHost}:${Port}"

  Set-Location $webDir
  $env:PLAYWRIGHT_BASE_URL = "http://${BindHost}:${Port}"
  $testArgs = @('playwright', 'test') + $TestFiles
  Write-Host "[quant-gate] playwright => npx $($testArgs -join ' ')" -ForegroundColor Cyan
  & npx @testArgs
  if ($LASTEXITCODE -ne 0) {
    throw "playwright failed with exit code $LASTEXITCODE"
  }

  Write-Host '[quant-gate] production regression => passed' -ForegroundColor Green
} finally {
  if ($proc -and !$proc.HasExited) {
    Write-Host "[quant-gate] stop web pid=$($proc.Id)" -ForegroundColor Yellow
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
