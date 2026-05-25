param(
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 8012,
  [switch]$Reload = $true
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'apps\api')

$reloadFlag = if ($Reload) { '--reload' } else { '' }
$cmd = "python -m uvicorn app.main:app --host $BindHost --port $Port $reloadFlag".Trim()
Write-Host "[quant-gate] API => $cmd" -ForegroundColor Cyan
Invoke-Expression $cmd
