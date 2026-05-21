def apply_slippage(side: str, price: float, slippage_rate: float, is_close: bool = False) -> float:
    """Apply slippage to a price. side='long'|'short', action determined by is_close."""
    rate = max(float(slippage_rate or 0.0), 0.0)
    if side == "long":
        multiplier = 1 - rate if is_close else 1 + rate
    else:
        multiplier = 1 + rate if is_close else 1 - rate
    return float(price) * multiplier


def calc_fee(notional: float, fee_rate: float) -> float:
    """Calculate trading fee on notional value."""
    return max(float(notional), 0.0) * max(float(fee_rate or 0.0), 0.0)


def risk_check(balance: float, order_notional: float, max_risk_ratio: float = 0.1) -> bool:
    if balance <= 0:
        return False
    return (order_notional / balance) <= max_risk_ratio


def calc_position_qty_by_margin(entry_price: float, allocated_margin: float, leverage: int) -> float:
    if entry_price <= 0 or allocated_margin <= 0 or leverage <= 0:
        return 0.0
    return (allocated_margin * leverage) / entry_price


def calc_stop_loss_price(entry_price: float, side: str, stop_loss_pct: float) -> float:
    if side == "long":
        return entry_price * (1 - stop_loss_pct)
    return entry_price * (1 + stop_loss_pct)


def calc_take_profit_price(entry_price: float, side: str, take_profit_pct: float) -> float:
    if side == "long":
        return entry_price * (1 + take_profit_pct)
    return entry_price * (1 - take_profit_pct)


def calc_position_qty_by_risk(account_equity: float, risk_per_trade_pct: float, entry_price: float, stop_loss_price: float) -> float:
    if account_equity <= 0 or risk_per_trade_pct <= 0:
        return 0.0
    stop_distance = abs(entry_price - stop_loss_price)
    if stop_distance <= 0:
        return 0.0
    risk_capital = account_equity * risk_per_trade_pct
    return risk_capital / stop_distance


def calc_allocated_margin_by_risk(account_equity: float, risk_per_trade_pct: float, entry_price: float, stop_loss_price: float, leverage: int) -> float:
    qty = calc_position_qty_by_risk(account_equity, risk_per_trade_pct, entry_price, stop_loss_price)
    if qty <= 0 or leverage <= 0:
        return 0.0
    notional = entry_price * qty
    return notional / leverage


def build_risk_sized_order(
    *,
    side: str,
    account_equity: float,
    entry_price: float,
    leverage: int,
    risk_per_trade_pct: float,
    stop_loss_pct: float,
    take_profit_pct: float,
    allocated_margin_cap: float | None = None,
) -> dict:
    stop_loss_price = calc_stop_loss_price(entry_price, side, stop_loss_pct)
    take_profit_price = calc_take_profit_price(entry_price, side, take_profit_pct)
    qty = calc_position_qty_by_risk(account_equity, risk_per_trade_pct, entry_price, stop_loss_price)
    risk_based_allocated_margin = calc_allocated_margin_by_risk(
        account_equity,
        risk_per_trade_pct,
        entry_price,
        stop_loss_price,
        leverage,
    )
    effective_allocated_margin = risk_based_allocated_margin
    if allocated_margin_cap is not None and allocated_margin_cap > 0:
        effective_allocated_margin = min(allocated_margin_cap, risk_based_allocated_margin) if risk_based_allocated_margin > 0 else allocated_margin_cap
    return {
        "side": side,
        "entry_price": entry_price,
        "stop_loss_price": stop_loss_price,
        "take_profit_price": take_profit_price,
        "qty": qty,
        "risk_based_allocated_margin": risk_based_allocated_margin,
        "effective_allocated_margin": effective_allocated_margin,
    }


def calc_max_loss(entry_price: float, stop_loss_price: float, qty: float) -> float:
    if qty <= 0:
        return 0.0
    return abs(entry_price - stop_loss_price) * qty


def leverage_risk_check(
    account_equity: float,
    available_balance: float,
    entry_price: float,
    stop_loss_price: float,
    allocated_margin: float,
    leverage: int,
    max_loss_ratio: float = 0.02,
    margin_limit_ratio: float = 0.2,
):
    qty = calc_position_qty_by_margin(entry_price, allocated_margin, leverage)
    notional = entry_price * qty
    initial_margin = notional / leverage if leverage > 0 else notional
    max_loss = calc_max_loss(entry_price, stop_loss_price, qty)
    equity_risk_ratio = (max_loss / account_equity) if account_equity > 0 else 1.0
    allowed = True

    if initial_margin > available_balance * margin_limit_ratio:
        allowed = False
    if equity_risk_ratio > max_loss_ratio:
        allowed = False

    return {
        "allowed": allowed,
        "qty": qty,
        "notional": notional,
        "initial_margin": initial_margin,
        "max_loss": max_loss,
        "equity_risk_ratio": equity_risk_ratio,
        "leverage": leverage,
    }
