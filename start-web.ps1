param(
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 3002,
  [string]$ApiBase = 'http://127.0.0.1:8012',
  [switch]$Production
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'apps\web')

$env:NEXT_PUBLIC_API_BASE = $ApiBase

function Sync-NextServerChunks {
  $serverDir = Join-Path (Get-Location) '.next\server'
  $chunksDir = Join-Path $serverDir 'chunks'
  if (!(Test-Path $serverDir) -or !(Test-Path $chunksDir)) {
    return
  }

  Get-ChildItem $chunksDir -File -Filter '*.js' | ForEach-Object {
    $target = Join-Path $serverDir $_.Name
    if (!(Test-Path $target)) {
      Copy-Item $_.FullName $target -Force
    }
  }
}

if ($Production) {
  Write-Host "[quant-gate] WEB => NEXT_PUBLIC_API_BASE=$ApiBase ; next build" -ForegroundColor Cyan
  node node_modules\next\dist\bin\next build
  Sync-NextServerChunks
  Write-Host "[quant-gate] WEB => NEXT_PUBLIC_API_BASE=$ApiBase ; next start --hostname $BindHost --port $Port" -ForegroundColor Cyan
  node node_modules\next\dist\bin\next start --hostname $BindHost --port $Port
} else {
  Write-Host "[quant-gate] WEB => NEXT_PUBLIC_API_BASE=$ApiBase ; next dev --hostname $BindHost --port $Port" -ForegroundColor Cyan
  node node_modules\next\dist\bin\next dev --hostname $BindHost --port $Port
}
