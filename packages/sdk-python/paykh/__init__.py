"""Official Python SDK for the PayKH Bakong KHQR payment gateway.

Example:
    >>> import paykh
    >>> client = paykh.PayKH("bk_test_xxx")
    >>> payment = client.payments.create(amount="1.50", currency="USD")
"""

from .client import PayKH, PayKHError
from .webhooks import verify_webhook, construct_event, VerifyResult

__all__ = [
    "PayKH",
    "PayKHError",
    "verify_webhook",
    "construct_event",
    "VerifyResult",
]

__version__ = "0.1.0"
