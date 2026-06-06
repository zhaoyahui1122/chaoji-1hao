from app.services.runner_log_store import load_logs


def test_load_logs_accepts_limit(monkeypatch):
    monkeypatch.setattr('app.services.runner_log_store.load_kv', lambda namespace, key, default=None: [
        {'id': 1},
        {'id': 2},
        {'id': 3},
    ])

    logs = load_logs(limit=2)

    assert [item['id'] for item in logs] == [2, 3]
