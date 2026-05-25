# Turtle Strategy 12-Hour Backtest Runner (15m timeframe)
# Passes optimized turtle config in each request

$ErrorActionPreference = "Continue"
$apiUrl = "http://127.0.0.1:8012"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$logFile = "$desktopPath\turtle_12h_log_$timestamp.txt"
$tradeFile = "$desktopPath\turtle_12h_trades_$timestamp.csv"

# Optimized turtle config
$turtleConfig = @{
    strategy_type = "turtle"
    symbol = "BTC_USDT"
    timeframe = "15m"
    data_source = "gate"
    leverage = 50
    allocated_margin = 1000
    use_boll = $false
    boll_period = 20
    boll_std = 2.0
    use_rsi = $false
    rsi_period = 14
    rsi_oversold = 30
    rsi_overbought = 70
    use_ma = $false
    ma_short = 9
    ma_long = 21
    turtle_entry_period = 30
    turtle_exit_period = 5
    turtle_atr_period = 10
    turtle_atr_filter = 0.0
    stop_loss_pct = 0.01
    take_profit_pct = 0.02
    risk_per_trade_pct = 0.01
    fee_rate = 0.0005
    slippage_rate = 0.0002
}
$configJson = $turtleConfig | ConvertTo-Json -Compress

# Reset paper account first to clear any existing positions
try {
    $resetBody = '{}' | ConvertFrom-Json
    $resetResult = Invoke-RestMethod -Uri "$apiUrl/runner/reset-paper" -Method POST -ContentType "application/json" -Body '{}' -TimeoutSec 10
    Write-Host "Paper account reset: $($resetResult.closed_positions) positions closed, equity=$($resetResult.equity)" -ForegroundColor Yellow
} catch {
    Write-Host "Warning: Could not reset paper account: $_" -ForegroundColor Red
}

# Get initial state
$snapshot = Invoke-RestMethod -Uri "$apiUrl/paper/snapshot" -Method GET -TimeoutSec 10
$initialEquity = $snapshot.account.equity

@"
TURTLE STRATEGY 12-HOUR BACKTEST (15m)
=======================================
Start Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Initial Equity: $initialEquity
Strategy: BTC_USDT 15m | Entry=30 Exit=5 ATR=10 | 50x | SL=1% TP=2% Risk=1%
Interval: Every 15 minutes
Config: Optimized Turtle (passed in request body)
"@ | Out-File -FilePath $logFile -Encoding UTF8

"Time,RunNum,Action,Side,Price,Qty,Fee,Slippage,PnL,UnrealizedPnL,Equity,Detail" | Out-File -FilePath $tradeFile -Encoding UTF8

$startTime = Get-Date
$endTime = $startTime.AddHours(12)
$runCount = 0
$openCount = 0
$closeCount = 0
$totalPnl = 0
$wins = 0
$losses = 0

Write-Host "=== TURTLE 12H BACKTEST STARTED ===" -ForegroundColor Green
Write-Host "Config: Entry=30 Exit=5 ATR=10 50x BTC_USDT 15m"
Write-Host "End: $($endTime.ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host ""

while ((Get-Date) -lt $endTime) {
    $runCount++
    $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    
    try {
        # Pass turtle config in request body
        $result = Invoke-RestMethod -Uri "$apiUrl/runner/run-once" -Method POST -ContentType "application/json" -Body $configJson -TimeoutSec 30
        
        $signal = if ($result.signal) { $result.signal } else { "null" }
        $action = if ($result.action) { $result.action } else { "none" }
        $price = $result.price
        
        $snap = Invoke-RestMethod -Uri "$apiUrl/paper/snapshot" -Method GET -TimeoutSec 10
        $equity = [math]::Round($snap.account.equity, 2)
        $unrealized = [math]::Round($snap.account.unrealized_pnl, 2)
        $posCount = $snap.account.open_positions
        
        $pnl = 0
        $fee = 0
        $slippage = 0
        $side = ""
        $qty = 0
        $detail = ""
        $strategyUsed = ""
        
        if ($result.result -and $result.result.event) {
            $evt = $result.result.event
            $eventType = $evt.event_type
            $side = $evt.side
            $qty = [math]::Round($evt.qty, 6)
            
            if ($evt.meta_json) {
                try {
                    $meta = $evt.meta_json | ConvertFrom-Json
                    if ($meta.strategy_type) { $strategyUsed = $meta.strategy_type }
                    if ($meta.entry_fee) { $fee = [math]::Round($meta.entry_fee, 4) }
                    if ($meta.entry_slippage_cost) { $slippage = [math]::Round($meta.entry_slippage_cost, 4) }
                    if ($meta.exit_fee) { $fee += [math]::Round($meta.exit_fee, 4) }
                    if ($meta.exit_slippage_cost) { $slippage += [math]::Round($meta.exit_slippage_cost, 4) }
                    if ($meta.realized_pnl) { $pnl = [math]::Round($meta.realized_pnl, 4) }
                    if ($meta.turtle_signal) { $detail = "turtle=$($meta.turtle_signal)" }
                    if ($meta.atr) { $detail += " atr=$([math]::Round($meta.atr, 2))" }
                    if ($meta.close_reason) { $detail += " reason=$($meta.close_reason)" }
                } catch {}
            }
            
            if ($eventType -eq "open") {
                $openCount++
                $color = if ($side -eq "long") { "Green" } else { "Cyan" }
                Write-Host "[$now] #$runCount OPEN $side $qty @ $price | fee=$fee | strategy=$strategyUsed | $detail" -ForegroundColor $color
                "$now,$runCount,OPEN,$side,$price,$qty,$fee,$slippage,0,$unrealized,$equity,$detail" | Out-File -FilePath $tradeFile -Append -Encoding UTF8
            }
            elseif ($eventType -eq "close") {
                $closeCount++
                $totalPnl += $pnl
                if ($pnl -gt 0) { $wins++ } else { $losses++ }
                $color = if ($pnl -gt 0) { "Green" } else { "Red" }
                Write-Host "[$now] #$runCount CLOSE PnL=$pnl @ $price | fee=$fee | equity=$equity" -ForegroundColor $color
                "$now,$runCount,CLOSE,$side,$price,$qty,$fee,$slippage,$pnl,$unrealized,$equity,$detail" | Out-File -FilePath $tradeFile -Append -Encoding UTF8
            }
            elseif ($eventType -eq "mark") {
                Write-Host "[$now] #$runCount MARK $price | unrealized=$unrealized | signal=$signal | strategy=$strategyUsed" -ForegroundColor DarkGray
            }
        }
        else {
            $winRate = if ($closeCount -gt 0) { [math]::Round($wins/$closeCount*100, 1) } else { 0 }
            Write-Host "[$now] #$runCount no-signal | BTC=$price | equity=$equity | unrealized=$unrealized | trades=$closeCount wr=$winRate%" -ForegroundColor DarkYellow
        }
        
        $winRate = if ($closeCount -gt 0) { [math]::Round($wins/$closeCount*100, 1) } else { 0 }
        "[$now] #$runCount | action=$action signal=$signal | opens=$openCount closes=$closeCount winRate=$winRate% pnl=$totalPnl | equity=$equity" | Out-File -FilePath $logFile -Append -Encoding UTF8
        
    } catch {
        $errMsg = "[$now] #$runCount ERROR: $_"
        Write-Host $errMsg -ForegroundColor Red
        $errMsg | Out-File -FilePath $logFile -Append -Encoding UTF8
    }
    
    # Wait 15 minutes
    $nextRun = (Get-Date).AddMinutes(15).ToString('HH:mm:ss')
    Write-Host "  -> Next at $nextRun (15min)" -ForegroundColor DarkGray
    Write-Host ""
    Start-Sleep -Seconds 900
}

# Final summary
$finalSnap = Invoke-RestMethod -Uri "$apiUrl/paper/snapshot" -Method GET -TimeoutSec 10
$finalEquity = [math]::Round($finalSnap.account.equity, 2)
$finalUnrealized = [math]::Round($finalSnap.account.unrealized_pnl, 2)
$netProfit = [math]::Round($finalEquity - $initialEquity, 2)
$netReturn = [math]::Round(($finalEquity - $initialEquity) / $initialEquity * 100, 2)
$winRate = if ($closeCount -gt 0) { [math]::Round($wins/$closeCount*100, 2) } else { 0 }
$avgPnl = if ($closeCount -gt 0) { [math]::Round($totalPnl/$closeCount, 4) } else { 0 }

$summary = @"

============================================
TURTLE 12-HOUR BACKTEST SUMMARY
============================================
End Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Initial Equity: $initialEquity
Final Equity: $finalEquity
Net Profit: $netProfit ($netReturn%)
Realized PnL (session): $totalPnl
Final Unrealized: $finalUnrealized

TRADES:
  Runs: $runCount
  Opens: $openCount
  Closes: $closeCount
  Win Rate: $winRate%
  Wins: $wins / Losses: $losses
  Avg PnL: $avgPnl
============================================
"@

Write-Host $summary -ForegroundColor Yellow
$summary | Out-File -FilePath $logFile -Append -Encoding UTF8

Write-Host "Done! Log: $logFile"
Write-Host "Trades: $tradeFile"
