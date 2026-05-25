# Turtle Strategy 2-Hour Backtest Runner
# Uses real Gate.io market data, runs every 5 minutes

$ErrorActionPreference = "Continue"
$apiUrl = "http://127.0.0.1:8012"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$logFile = "$desktopPath\turtle_log_$timestamp.txt"
$tradeFile = "$desktopPath\turtle_trades_$timestamp.csv"

# Get initial state
$snapshot = Invoke-RestMethod -Uri "$apiUrl/paper/snapshot" -Method GET -TimeoutSec 10
$initialEquity = $snapshot.account.equity
$initialRealized = $snapshot.account.realized_pnl

# Init log
@"
TURTLE STRATEGY 2-HOUR BACKTEST
================================
Start Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Initial Equity: $initialEquity
Initial Realized PnL: $initialRealized
Strategy: BTC_USDT 5m | Entry=30 Exit=5 ATR=10 | 50x | SL=1% TP=2% Risk=1%
Interval: Every 5 minutes
"@ | Out-File -FilePath $logFile -Encoding UTF8

"Time,RunNum,Action,Side,Price,Qty,Fee,Slippage,PnL,UnrealizedPnL,Equity,Detail" | Out-File -FilePath $tradeFile -Encoding UTF8

# Reset paper account first
try {
    $resetResult = Invoke-RestMethod -Uri "$apiUrl/runner/reset-paper" -Method POST -ContentType "application/json" -Body '{}' -TimeoutSec 10
    Write-Host "Paper account reset: $($resetResult.closed_positions) positions closed" -ForegroundColor Yellow
} catch {
    Write-Host "Warning: Could not reset: $_" -ForegroundColor Red
}

$startTime = Get-Date
$endTime = $startTime.AddHours(2)
$runCount = 0
$openCount = 0
$closeCount = 0
$totalPnl = 0
$wins = 0
$losses = 0

Write-Host "=== TURTLE BACKTEST STARTED ===" -ForegroundColor Green
Write-Host "Start: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "End: $($endTime.ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host "Initial Equity: $initialEquity"
Write-Host ""

while ((Get-Date) -lt $endTime) {
    $runCount++
    $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    
    try {
        # Run strategy once (slot 1 = turtle optimized)
        $result = Invoke-RestMethod -Uri "$apiUrl/runner/run-once" -Method POST -ContentType "application/json" -Body '{}' -TimeoutSec 30
        
        $signal = if ($result.signal) { $result.signal } else { "null" }
        $action = if ($result.action) { $result.action } else { "none" }
        $price = $result.price
        
        # Get current account state
        $snap = Invoke-RestMethod -Uri "$apiUrl/paper/snapshot" -Method GET -TimeoutSec 10
        $equity = [math]::Round($snap.account.equity, 2)
        $unrealized = [math]::Round($snap.account.unrealized_pnl, 2)
        $realized = [math]::Round($snap.account.realized_pnl, 2)
        $posCount = $snap.account.open_positions
        
        $pnl = 0
        $fee = 0
        $slippage = 0
        $side = ""
        $qty = 0
        $detail = ""
        
        # Process trade event
        if ($result.result -and $result.result.event) {
            $evt = $result.result.event
            $eventType = $evt.event_type
            $side = $evt.side
            $qty = [math]::Round($evt.qty, 6)
            
            if ($evt.meta_json) {
                try {
                    $meta = $evt.meta_json | ConvertFrom-Json
                    if ($meta.entry_fee) { $fee = [math]::Round($meta.entry_fee, 4) }
                    if ($meta.entry_slippage_cost) { $slippage = [math]::Round($meta.entry_slippage_cost, 4) }
                    if ($meta.exit_fee) { $fee += [math]::Round($meta.exit_fee, 4) }
                    if ($meta.exit_slippage_cost) { $slippage += [math]::Round($meta.exit_slippage_cost, 4) }
                    if ($meta.realized_pnl) { $pnl = [math]::Round($meta.realized_pnl, 4) }
                    if ($meta.turtle_signal) { $detail = "turtle=$($meta.turtle_signal)" }
                    if ($meta.atr) { $detail += " atr=$([math]::Round($meta.atr, 2))" }
                } catch {}
            }
            
            if ($eventType -eq "open") {
                $openCount++
                $color = if ($side -eq "long") { "Green" } else { "Cyan" }
                Write-Host "[$now] #$runCount OPEN $side $qty @ $price | fee=$fee slip=$slippage | $detail" -ForegroundColor $color
                "$now,$runCount,OPEN,$side,$price,$qty,$fee,$slippage,0,$unrealized,$equity,$detail" | Out-File -FilePath $tradeFile -Append -Encoding UTF8
            }
            elseif ($eventType -eq "close") {
                $closeCount++
                $totalPnl += $pnl
                if ($pnl -gt 0) { $wins++ } else { $losses++ }
                $color = if ($pnl -gt 0) { "Green" } else { "Red" }
                Write-Host "[$now] #$runCount CLOSE $side PnL=$pnl @ $price | fee=$fee slip=$slippage | equity=$equity" -ForegroundColor $color
                "$now,$runCount,CLOSE,$side,$price,$qty,$fee,$slippage,$pnl,$unrealized,$equity,$detail" | Out-File -FilePath $tradeFile -Append -Encoding UTF8
            }
            elseif ($eventType -eq "mark") {
                Write-Host "[$now] #$runCount MARK $price | unrealized=$unrealized | signal=$signal" -ForegroundColor DarkGray
            }
        }
        else {
            Write-Host "[$now] #$runCount no-signal | price=$price | equity=$equity unrealized=$unrealized | positions=$posCount" -ForegroundColor DarkYellow
        }
        
        # Status line
        $winRate = if ($closeCount -gt 0) { [math]::Round($wins/$closeCount*100, 1) } else { 0 }
        $logLine = "[$now] #$runCount | action=$action signal=$signal | opens=$openCount closes=$closeCount winRate=$winRate% totalPnl=$totalPnl | equity=$equity"
        $logLine | Out-File -FilePath $logFile -Append -Encoding UTF8
        
    } catch {
        $errMsg = "[$now] #$runCount ERROR: $_"
        Write-Host $errMsg -ForegroundColor Red
        $errMsg | Out-File -FilePath $logFile -Append -Encoding UTF8
    }
    
    # Wait 5 minutes
    $nextRun = (Get-Date).AddMinutes(5).ToString('HH:mm:ss')
    Write-Host "  -> Next run at $nextRun (waiting 5 min)" -ForegroundColor DarkGray
    Write-Host ""
    Start-Sleep -Seconds 300
}

# Final snapshot
$finalSnap = Invoke-RestMethod -Uri "$apiUrl/paper/snapshot" -Method GET -TimeoutSec 10
$finalEquity = [math]::Round($finalSnap.account.equity, 2)
$finalUnrealized = [math]::Round($finalSnap.account.unrealized_pnl, 2)
$finalRealized = [math]::Round($finalSnap.account.realized_pnl, 2)
$netProfit = [math]::Round($finalEquity - $initialEquity, 2)
$netReturn = [math]::Round(($finalEquity - $initialEquity) / $initialEquity * 100, 2)
$winRate = if ($closeCount -gt 0) { [math]::Round($wins/$closeCount*100, 2) } else { 0 }
$avgPnl = if ($closeCount -gt 0) { [math]::Round($totalPnl/$closeCount, 4) } else { 0 }
$avgWin = if ($wins -gt 0) { [math]::Round(($totalPnl + $losses * $avgPnl) / $wins, 4) } else { 0 }

$summary = @"

========================================
TURTLE STRATEGY 2-HOUR BACKTEST SUMMARY
========================================
End Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Initial Equity: $initialEquity
Final Equity: $finalEquity
Net Profit: $netProfit ($netReturn%)
Realized PnL (this session): $totalPnl
Final Unrealized PnL: $finalUnrealized

TRADE STATISTICS:
  Total Runs: $runCount
  Open Trades: $openCount
  Close Trades: $closeCount
  Win Rate: $winRate%
  Wins: $wins
  Losses: $losses
  Avg PnL per Trade: $avgPnl
========================================
"@

Write-Host $summary -ForegroundColor Yellow
$summary | Out-File -FilePath $logFile -Append -Encoding UTF8

Write-Host "Files saved to Desktop:"
Write-Host "  Log: $logFile"
Write-Host "  Trades: $tradeFile"
