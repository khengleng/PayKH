"""Webhook signature verification for PayKH.

Signature scheme (matches ``docs/webhooks.md``):

    header:  X-Payment-Signature: t=<timestamp>,v1=<hex hmac>
    v1    =  HMAC-SHA256(signing_secret, "{timestamp}.{raw_body}")  (hex)

Verification enforces a constant-time digest comparison and a timestamp
tolerance to protect against replay attacks.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, NamedTuple, Optional, Union

DEFAULT_TOLERANCE_SECONDS = 300


class VerifyResult(NamedTuple):
    """Outcome of :func:`verify_webhook`.

    ``reason`` is one of ``"malformed"``, ``"timestamp_out_of_tolerance"``,
    or ``"signature_mismatch"`` when ``valid`` is ``False``.
    """

    valid: bool
    reason: Optional[str] = None

    def __bool__(self) -> bool:
        return self.valid


def _to_bytes(value: Union[str, bytes]) -> bytes:
    if isinstance(value, bytes):
        return value
    return value.encode("utf-8")


def _parse_header(signature_header: str):
    timestamp: Optional[int] = None
    v1: Optional[str] = None
    for part in (signature_header or "").split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, _, val = part.partition("=")
        key = key.strip()
        val = val.strip()
        if key == "t":
            try:
                timestamp = int(val)
            except (TypeError, ValueError):
                timestamp = None
        elif key == "v1":
            v1 = val
    return timestamp, v1


def verify_webhook(
    raw_body: Union[str, bytes],
    signature_header: str,
    secret: str,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now_seconds: Optional[int] = None,
) -> VerifyResult:
    """Verify an inbound webhook signature.

    Args:
        raw_body: The exact request body received (``str`` or ``bytes``).
            Do NOT re-serialize the JSON before verifying.
        signature_header: The ``X-Payment-Signature`` header value.
        secret: The endpoint signing secret (``whsec_...``).
        tolerance_seconds: Max allowed clock skew (default 300 = 5 minutes).
        now_seconds: Override the current time (primarily for testing).

    Returns:
        A :class:`VerifyResult`, truthy when the signature is valid.
    """
    timestamp, v1 = _parse_header(signature_header)
    if timestamp is None or not v1:
        return VerifyResult(False, "malformed")

    now = int(time.time()) if now_seconds is None else int(now_seconds)
    if abs(now - timestamp) > tolerance_seconds:
        return VerifyResult(False, "timestamp_out_of_tolerance")

    body = _to_bytes(raw_body)
    signed_payload = str(timestamp).encode("ascii") + b"." + body
    expected = hmac.new(
        _to_bytes(secret), signed_payload, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, v1):
        return VerifyResult(False, "signature_mismatch")

    return VerifyResult(True)


def construct_event(
    raw_body: Union[str, bytes],
    signature_header: str,
    secret: str,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
) -> Any:
    """Verify a webhook signature and return the parsed JSON event.

    Raises:
        PayKHError: with code ``"invalid_signature"`` (status 400) when the
            signature is not valid.
    """
    from .client import PayKHError

    result = verify_webhook(raw_body, signature_header, secret, tolerance_seconds)
    if not result.valid:
        raise PayKHError(
            "invalid_signature",
            "Webhook signature verification failed: " + str(result.reason),
            400,
        )
    body = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else raw_body
    return json.loads(body)
