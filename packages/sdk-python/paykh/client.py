"""PayKH REST API client (standard-library only)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

DEFAULT_BASE_URL = "https://api.paykh.cambobia.com"
DEFAULT_TIMEOUT_SECONDS = 15.0


class PayKHError(Exception):
    """Raised when the PayKH API returns an error envelope.

    Mirrors the ``{error, message, request_id}`` shape returned by the API.

    Attributes:
        code: The machine-readable error code (e.g. ``"payment_not_found"``).
        message: A human-readable description.
        status: The HTTP status code.
        request_id: The API request id, when present (also in ``x-request-id``).
    """

    def __init__(
        self,
        code: str,
        message: str,
        status: int,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.request_id = request_id

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return (
            f"PayKHError(code={self.code!r}, status={self.status}, "
            f"message={self.message!r}, request_id={self.request_id!r})"
        )


def _to_query(params: Optional[Dict[str, Any]]) -> str:
    if not params:
        return ""
    pairs = []
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, bool):
            value = "true" if value else "false"
        pairs.append((key, str(value)))
    query = urllib.parse.urlencode(pairs)
    return f"?{query}" if query else ""


class _Payments:
    """Namespace for payment operations, exposed as ``client.payments``."""

    def __init__(self, client: "PayKH") -> None:
        self._client = client

    def create(
        self,
        idempotency_key: Optional[str] = None,
        **params: Any,
    ) -> Dict[str, Any]:
        """Create a payment.

        Pass payment fields as keyword arguments, e.g.
        ``create(amount="1.50", currency="USD", reference_id="order_1024")``.
        Provide ``idempotency_key`` to send the ``Idempotency-Key`` header.
        """
        return self._client._request(
            "POST",
            "/v1/payments",
            body=params,
            idempotency_key=idempotency_key,
        )

    def retrieve(self, id: str) -> Dict[str, Any]:
        """Retrieve a single payment by id."""
        path = "/v1/payments/" + urllib.parse.quote(str(id), safe="")
        return self._client._request("GET", path)

    def list(self, **params: Any) -> Dict[str, Any]:
        """List payments. Accepts filters like ``status``, ``reference_id``,
        ``created_from``, ``created_to``, ``limit``, ``cursor``."""
        return self._client._request("GET", "/v1/payments" + _to_query(params))

    def cancel(self, id: str) -> Dict[str, Any]:
        """Cancel a payment by id (only before completion)."""
        path = "/v1/payments/" + urllib.parse.quote(str(id), safe="") + "/cancel"
        return self._client._request("POST", path)


class _Webhooks:
    """Namespace mirroring the Node SDK's ``client.webhooks``."""

    def __init__(self) -> None:
        from . import webhooks as _wh

        self.verify = _wh.verify_webhook
        self.construct_event = _wh.construct_event


class PayKH:
    """PayKH API client.

    Example:
        >>> client = PayKH("bk_live_xxx")
        >>> payment = client.payments.create(amount="1.50", currency="USD")
    """

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        if not api_key:
            raise ValueError("An API key is required")
        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._timeout = timeout_seconds
        self.payments = _Payments(self)
        self.webhooks = _Webhooks()

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        url = self._base_url + path
        headers = {
            "Authorization": "Bearer " + self._api_key,
            "Accept": "application/json",
        }
        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        request = urllib.request.Request(
            url, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            self._raise_from_http_error(exc)
        except urllib.error.URLError as exc:  # network / timeout
            raise PayKHError("connection_error", str(exc.reason), 0, None) from exc

    @staticmethod
    def _raise_from_http_error(exc: "urllib.error.HTTPError") -> None:
        status = exc.code
        request_id = exc.headers.get("x-request-id") if exc.headers else None
        payload: Dict[str, Any] = {}
        try:
            raw = exc.read().decode("utf-8")
            if raw:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    payload = parsed
        except (ValueError, OSError):
            payload = {}
        code = payload.get("error") or "error"
        message = payload.get("message") or f"HTTP {status}"
        request_id = payload.get("request_id") or request_id
        raise PayKHError(code, message, status, request_id)
