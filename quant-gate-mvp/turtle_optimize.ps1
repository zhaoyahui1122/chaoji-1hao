# Turtle Strategy Optimization Script
$baseUrl = "http://127.0.0.1:8012/backtest"
$results = [System.Collections.ArrayList]::new()

function Run-Backtest($params) {
    $body = $params | ConvertTo-Json
    try {
        $resp = Invoke-RestMethod -Uri $baseUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 120
        return $resp.summary
    } catch {
        Write-Host "ERROR: $_"
        return $null
    }
}

function Record-Result($label, $params, $summary) {
    $script:results.Add([PSCustomObject]@{
        Label = $label
        EntryPeriod = $params.turtle_entry_period
        ExitPeriod = $params.turtle_exit_period
        AtrPeriod = $params.turtle_atr_period
        StopLoss = $params.stop_loss_pct
        TakeProfit = $params.take_profit_pct
        WinRate = $summary.win_rate_pct
        ReturnPct = $summary.return_pct
        Trades = $summary.trades
        MaxDrawdown = $summary.max_drawdown_pct
        NetPnl = $summary.net_pnl
    }) | Out-Null
    Write-Host ("{0} | WR={1}% | Ret={2}% | Trades={3} | DD={4}%" -f $label, $summary.win_rate_pct, $summary.return_pct, $summary.trades, $summary.max_drawdown_pct)
}

$baseParams = @{
    strategy_type = "turtle"
    symbol = "BTC_USDT"
    timeframe = "5m"
    data_source = "gate"
    leverage = 50
    initial_balance = 10000
    allocated_margin = 1000
    turtle_entry_period = 20
    turtle_exit_period = 10
    turtle_atr_period = 14
    stop_loss_pct = 0.02
    take_profit_pct = 0.04
}

# Step 2a: Optimize entry_period
Write-Host ""
Write-Host "=== STEP 2a: Optimize Entry Period ==="
$bestEntry = 20; $bestEntryWR = 0
foreach ($ep in @(10, 15, 20, 25, 30)) {
    $p = $baseParams.Clone()
    $p.turtle_entry_period = $ep
    $s = Run-Backtest $p
    if ($s -and $s.trades -ge 3) {
        Record-Result ("entry={0}" -f $ep) $p $s
        if ($s.win_rate_pct -gt $bestEntryWR) { $bestEntryWR = $s.win_rate_pct; $bestEntry = $ep }
    }
}
Write-Host ("Best entry_period: {0} (WR={1}%)" -f $bestEntry, $bestEntryWR)
$baseParams.turtle_entry_period = $bestEntry

# Step 2b: Optimize exit_period
Write-Host ""
Write-Host "=== STEP 2b: Optimize Exit Period ==="
$bestExit = 10; $bestExitWR = 0
foreach ($xp in @(5, 8, 10, 15)) {
    $p = $baseParams.Clone()
    $p.turtle_exit_period = $xp
    $s = Run-Backtest $p
    if ($s -and $s.trades -ge 3) {
        Record-Result ("exit={0}" -f $xp) $p $s
        if ($s.win_rate_pct -gt $bestExitWR) { $bestExitWR = $s.win_rate_pct; $bestExit = $xp }
    }
}
Write-Host ("Best exit_period: {0} (WR={1}%)" -f $bestExit, $bestExitWR)
$baseParams.turtle_exit_period = $bestExit

# Step 2c: Optimize atr_period
Write-Host ""
Write-Host "=== STEP 2c: Optimize ATR Period ==="
$bestAtr = 14; $bestAtrWR = 0
foreach ($ap in @(10, 14, 20)) {
    $p = $baseParams.Clone()
    $p.turtle_atr_period = $ap
    $s = Run-Backtest $p
    if ($s -and $s.trades -ge 3) {
        Record-Result ("atr={0}" -f $ap) $p $s
        if ($s.win_rate_pct -gt $bestAtrWR) { $bestAtrWR = $s.win_rate_pct; $bestAtr = $ap }
    }
}
Write-Host ("Best atr_period: {0} (WR={1}%)" -f $bestAtr, $bestAtrWR)
$baseParams.turtle_atr_period = $bestAtr

# Step 2d: Optimize stop_loss and take_profit
Write-Host ""
Write-Host "=== STEP 2d: Optimize SL/TP ==="
$bestSL = 0.02; $bestTP = 0.04; $bestSlTpWR = 0
foreach ($sl in @(0.01, 0.015, 0.02, 0.03)) {
    foreach ($tp in @(0.02, 0.03, 0.04, 0.06)) {
        if ($tp -le $sl) { continue }
        $p = $baseParams.Clone()
        $p.stop_loss_pct = $sl
        $p.take_profit_pct = $tp
        $s = Run-Backtest $p
        if ($s -and $s.trades -ge 3) {
            Record-Result ("sl={0},tp={1}" -f $sl, $tp) $p $s
            if ($s.win_rate_pct -gt $bestSlTpWR) { $bestSlTpWR = $s.win_rate_pct; $bestSL = $sl; $bestTP = $tp }
        }
    }
}
Write-Host ("Best SL/TP: sl={0}, tp={1} (WR={2}%)" -f $bestSL, $bestTP, $bestSlTpWR)
$baseParams.stop_loss_pct = $bestSL
$baseParams.take_profit_pct = $bestTP

# Final params
Write-Host ""
Write-Host "=== OPTIMAL PARAMS ==="
Write-Host ("entry_period={0}" -f $baseParams.turtle_entry_period)
Write-Host ("exit_period={0}" -f $baseParams.turtle_exit_period)
Write-Host ("atr_period={0}" -f $baseParams.turtle_atr_period)
Write-Host ("stop_loss={0}" -f $baseParams.stop_loss_pct)
Write-Host ("take_profit={0}" -f $baseParams.take_profit_pct)

# Save results
$results | Export-Csv -Path "C:\Users\14513\.openclaw\workspace\quant-gate-mvp\opt_results.csv" -NoTypeInformation
Write-Host ""
Write-Host "Results saved to opt_results.csv"
