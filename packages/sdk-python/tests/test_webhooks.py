"""Webhook signature verification tests.

Runnable with either pytest (`python3 -m pytest`) or the stdlib unittest
runner (`python3 -m unittest`), so no third-party deps are required.
"""

import hashlib
import hmac
import json
import time
import unittest

import paykh
from paykh import PayKHError, construct_event, verify_webhook

SECRET = "whsec_test_secret"


def _sign(raw_body, secret=SECRET, timestamp=None):
    """Build a valid `X-Payment-Signature` header for a body."""
    if timestamp is None:
        timestamp = int(time.time())
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    payload = str(timestamp).encode("ascii") + b"." + body
    v1 = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return "t={0},v1={1}".format(timestamp, v1)


class VerifyWebhookTests(unittest.TestCase):
    def setUp(self):
        self.body = json.dumps({"id": "evt_1", "type": "payment.completed"})

    def test_valid_signature_passes(self):
        header = _sign(self.body)
        result = verify_webhook(self.body, header, SECRET)
        self.assertTrue(result.valid)
        self.assertIsNone(result.reason)
        self.assertTrue(result)  # truthy via __bool__

    def test_valid_signature_with_bytes_body(self):
        raw = self.body.encode("utf-8")
        header = _sign(raw)
        self.assertTrue(verify_webhook(raw, header, SECRET).valid)

    def test_tampered_body_fails(self):
        header = _sign(self.body)
        tampered = self.body.replace("evt_1", "evt_hacked")
        result = verify_webhook(tampered, header, SECRET)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "signature_mismatch")

    def test_wrong_secret_fails(self):
        header = _sign(self.body, secret="whsec_other_secret")
        result = verify_webhook(self.body, header, SECRET)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "signature_mismatch")

    def test_out_of_tolerance_timestamp_fails(self):
        old_ts = int(time.time()) - 3600
        header = _sign(self.body, timestamp=old_ts)
        result = verify_webhook(self.body, header, SECRET, tolerance_seconds=300)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "timestamp_out_of_tolerance")

    def test_future_timestamp_out_of_tolerance_fails(self):
        future_ts = int(time.time()) + 3600
        header = _sign(self.body, timestamp=future_ts)
        result = verify_webhook(self.body, header, SECRET)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "timestamp_out_of_tolerance")

    def test_now_seconds_override(self):
        ts = 1_700_000_000
        header = _sign(self.body, timestamp=ts)
        result = verify_webhook(self.body, header, SECRET, now_seconds=ts + 10)
        self.assertTrue(result.valid)

    def test_malformed_header_missing_v1_fails(self):
        header = "t={0}".format(int(time.time()))
        result = verify_webhook(self.body, header, SECRET)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "malformed")

    def test_malformed_header_missing_t_fails(self):
        result = verify_webhook(self.body, "v1=deadbeef", SECRET)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "malformed")

    def test_malformed_header_empty_fails(self):
        result = verify_webhook(self.body, "", SECRET)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "malformed")

    def test_malformed_header_non_numeric_timestamp_fails(self):
        result = verify_webhook(self.body, "t=notanumber,v1=abcd", SECRET)
        self.assertFalse(result.valid)
        self.assertEqual(result.reason, "malformed")

    def test_header_with_extra_whitespace_passes(self):
        header = _sign(self.body)
        t_part, v1_part = header.split(",")
        spaced = " {0} , {1} ".format(t_part, v1_part)
        self.assertTrue(verify_webhook(self.body, spaced, SECRET).valid)


class ConstructEventTests(unittest.TestCase):
    def setUp(self):
        self.event = {"id": "evt_1", "type": "payment.completed"}
        self.body = json.dumps(self.event)

    def test_construct_event_returns_parsed_json(self):
        header = _sign(self.body)
        event = construct_event(self.body, header, SECRET)
        self.assertEqual(event, self.event)

    def test_construct_event_accepts_bytes(self):
        raw = self.body.encode("utf-8")
        header = _sign(raw)
        self.assertEqual(construct_event(raw, header, SECRET), self.event)

    def test_construct_event_raises_on_invalid_signature(self):
        with self.assertRaises(PayKHError) as ctx:
            construct_event(self.body, _sign(self.body, secret="nope"), SECRET)
        err = ctx.exception
        self.assertEqual(err.code, "invalid_signature")
        self.assertEqual(err.status, 400)
        self.assertIn("signature_mismatch", err.message)

    def test_construct_event_raises_on_malformed_header(self):
        with self.assertRaises(PayKHError) as ctx:
            construct_event(self.body, "garbage", SECRET)
        self.assertEqual(ctx.exception.code, "invalid_signature")


class PublicApiTests(unittest.TestCase):
    def test_exports(self):
        for name in ("PayKH", "PayKHError", "verify_webhook", "construct_event"):
            self.assertTrue(hasattr(paykh, name), name)

    def test_client_namespaces(self):
        client = paykh.PayKH("bk_test_xxx", base_url="http://localhost:4000")
        self.assertTrue(hasattr(client.payments, "create"))
        self.assertTrue(hasattr(client.payments, "retrieve"))
        self.assertTrue(hasattr(client.payments, "list"))
        self.assertTrue(hasattr(client.payments, "cancel"))
        self.assertTrue(callable(client.webhooks.verify))
        self.assertTrue(callable(client.webhooks.construct_event))

    def test_client_requires_api_key(self):
        with self.assertRaises(ValueError):
            paykh.PayKH("")

    def test_base_url_trailing_slash_stripped(self):
        client = paykh.PayKH("bk_test_xxx", base_url="http://localhost:4000/")
        self.assertEqual(client._base_url, "http://localhost:4000")


if __name__ == "__main__":
    unittest.main()
