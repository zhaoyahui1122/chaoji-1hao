from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any

import requests

GATE_API_BASE = "https://api.gateio.ws"
GATE_FUTURES_ACCOUNTS_PATH = "/api/v4/futures/usdt/accounts"
GATE_FUTURES_POSITIONS_PATH = "/api/v4/futures/usdt/positions"
GATE_FUTURES_CONTRACTS_PATH = "/api/v4/futures/usdt/contracts"


def build_gate_signature_headers(
    method: str,
    path: str,
    query_string: str,
    body: str,
    api_key: str,
    api_secret: str,
    timestamp: str,
) -> dict[str, str]:
    payload_hash = hashlib.sha512(body.encode("utf-8")).hexdigest()
    sign_payload = "\n".join([method.upper(), path, query_string, payload_hash, timestamp])
    sign = hmac.new(api_secret.encode("utf-8"), sign_payload.encode("utf-8"), hashlib.sha512).hexdigest()
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "KEY": api_key,
        "Timestamp": timestamp,
        "SIGN": sign,
    }


def _gate_private_request(
    method: str,
    path: str,
    api_key: str,
    api_secret: str,
    query_string: str = "",
    body: str = "",
    timeout: float = 15,
) -> Any:
    timestamp = str(int(time.time()))
    headers = build_gate_signature_headers(
        method=method,
        path=path,
        query_string=query_string,
        body=body,
        api_key=api_key,
        api_secret=api_secret,
        timestamp=timestamp,
    )
    url = f"{GATE_API_BASE}{path}"
    if query_string:
        url = f"{url}?{query_string}"
    try:
        response = requests.request(method=method.upper(), url=url, headers=headers, data=body or None, timeout=timeout)
    except requests.RequestException as exc:
        raise RuntimeError(f"gate_live_request_failed: {exc}") from exc

    if response.status_code in (401, 403):
        raise RuntimeError("gate_live_auth_failed")
    if response.status_code >= 400:
        raise RuntimeError(f"gate_live_request_failed: status_{response.status_code}")

    try:
        return response.json()
    except ValueError as exc:
        raise RuntimeError("gate_live_invalid_response") from exc


def fetch_futures_account(api_key: str, api_secret: str) -> dict[str, Any]:
    payload = _gate_private_request("GET", GATE_FUTURES_ACCOUNTS_PATH, api_key=api_key, api_secret=api_secret)
    if not isinstance(payload, dict):
        raise RuntimeError("gate_live_invalid_response")
    return payload


def fetch_futures_positions(api_key: str, api_secret: str) -> list[dict[str, Any]]:
    payload = _gate_private_request("GET", GATE_FUTURES_POSITIONS_PATH, api_key=api_key, api_secret=api_secret)
    if not isinstance(payload, list):
        raise RuntimeError("gate_live_invalid_response")
    return [item for item in payload if isinstance(item, dict)]


def fetch_contract_detail(contract: str) -> dict[str, Any]:
    """Fetch contract details from Gate.io (public endpoint)."""
    url = f"{GATE_API_BASE}{GATE_FUTURES_CONTRACTS_PATH}/{contract.upper()}"
    try:
        resp = requests.get(url, timeout=10)
    except requests.RequestException as exc:
        raise RuntimeError(f"gate_contract_fetch_failed: {exc}") from exc
    if resp.status_code >= 400:
        raise RuntimeError(f"gate_contract_fetch_failed: status_{resp.status_code}")
    data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError("gate_contract_invalid_response")
    return data
