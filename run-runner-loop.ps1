param(
  [string]$Symbol = 'BTC_USDT',
  [string]$Timeframe = '15m',
  [int]$Leverage = 5,
  [double]$AllocatedMargin = 1000,
  [string]$DataSource = 'gate',
  [int]$Loops = 12,
  [int]$SleepSeconds = 60
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

for ($i = 0; $i -lt $Loops; $i++) {
  Write-Host "[$((Get-Date).ToString('u'))] Running strategy cycle $($i + 1)/$Loops..." -ForegroundColor Cyan
  $body = @{
    symbol = $Symbol
    timeframe = $Timeframe
    data_source = $DataSource
    leverage = $Leverage
    allocated_margin = $AllocatedMargin
    boll_period = 20
    boll_std = 2.0
    rsi_period = 14
    ma_short = 9
    ma_long = 21
    stop_loss_pct = 0.02
  } | ConvertTo-Json

  Invoke-RestMethod -Uri 'http://localhost:8000/runner/run-once' -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 8

  if ($i -lt ($Loops - 1)) {
    Start-Sleep -Seconds $SleepSeconds
  }
}
