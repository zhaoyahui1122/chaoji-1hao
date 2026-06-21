param(
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 8012,
  [switch]$Reload = $true
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'apps\api')

$envFile = Join-Path (Get-Location) '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith('#') -or !$line.Contains('=')) {
      return
    }
    $parts = $line.Split('=', 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($name) {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

$reloadFlag = if ($Reload) { '--reload' } else { '' }
$cmd = "python -m uvicorn app.main:app --host $BindHost --port $Port $reloadFlag".Trim()
Write-Host "[quant-gate] API => $cmd" -ForegroundColor Cyan
Invoke-Expression $cmd
