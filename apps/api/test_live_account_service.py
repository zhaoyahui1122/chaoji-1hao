from app.services.live_account_service import build_live_account_snapshot


def test_build_live_account_snapshot_normalizes_account_and_positions():
    snapshot = build_live_account_snapshot(
        account_raw={"total": "1200", "available": "900"},
        positions_raw=[
            {
                "contract": "BTC_USDT",
                "size": "0.01",
                "leverage": "5",
                "entry_price": "64000",
                "mark_price": "64500",
                "unrealised_pnl": "5.0",
                "mode": "single",
            }
        ],
    )

    assert snapshot["account"]["equity"] == 1200.0
    assert snapshot["account"]["available_balance"] == 900.0
    assert snapshot["positions"][0]["symbol"] == "BTC_USDT"
    assert snapshot["positions"][0]["mark_price"] == 64500.0
