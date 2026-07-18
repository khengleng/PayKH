# Webhook Receiver Example

> A copy-paste receiver for PayKH webhooks. Wire this up at the URL you register
> in Dashboard → **Webhooks** (for the trustee integration that's
> `POST /api/v1/trustee/events`). Full contract:
> [`API-CONTRACT.md`](./API-CONTRACT.md).

Three things every receiver MUST do:

1. **Verify the signature over the raw request body** (not the parsed JSON).
2. **Respond `2xx` fast** — persist/enqueue, then process asynchronously.
3. **Dedupe on `X-Payment-Id`** — delivery is at-least-once.

---

## Node.js / Express

The raw body is required for signature verification, so capture it **before**
any JSON body parser rewrites it.

```ts
import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

const app = express();

// Capture the raw bytes; still expose the parsed object as req.body.
app.use('/api/v1/trustee/events', express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));

const SIGNING_SECRET = process.env.PAYKH_WEBHOOK_SECRET!; // whsec_...
const TOLERANCE_SECONDS = 300;

function verify(rawBody: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  let t: number | undefined;
  const v1s: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't') t = Number(v);
    if (k === 'v1' && v) v1s.push(v);
  }
  if (t === undefined || Number.isNaN(t) || v1s.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', SIGNING_SECRET)
    .update(`${t}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  // Accept a match against ANY presented v1 (secret-rotation window).
  return v1s.some((c) => {
    const b = Buffer.from(c, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const applied = new Set<string>(); // replace with a durable store (DB/Redis)

app.post('/api/v1/trustee/events', (req, res) => {
  if (!verify((req as any).rawBody, req.header('X-Payment-Signature'))) {
    return res.status(400).send('bad signature');
  }

  const eventId = req.header('X-Payment-Id')!;
  if (applied.has(eventId)) return res.status(200).send('duplicate ignored');

  // Persist/enqueue synchronously, then ACK. Do the heavy work off the request.
  applied.add(eventId);
  enqueueForProcessing(req.body); // your async worker

  return res.status(200).send('ok');
});

function enqueueForProcessing(event: any) {
  // event.type, event.data.payment.{id,status,amount,currency,reference_id,...}
}

app.listen(3000);
```

If you already depend on `@paykh/security`, the verification collapses to:

```ts
import { verifySignature } from '@paykh/security';

const r = verifySignature(SIGNING_SECRET, rawBody.toString('utf8'),
  req.header('X-Payment-Signature') ?? '');
if (!r.valid) return res.status(400).end(); // r.reason explains why
```

---

## Python / Flask

```python
import hashlib, hmac, os, time
from flask import Flask, request

app = Flask(__name__)
SIGNING_SECRET = os.environ["PAYKH_WEBHOOK_SECRET"].encode()
TOLERANCE = 300
applied = set()  # replace with a durable store

def verify(raw: bytes, header: str | None) -> bool:
    if not header:
        return False
    t, v1s = None, []
    for part in header.split(","):
        k, _, v = part.strip().partition("=")
        if k == "t":
            t = v
        elif k == "v1" and v:
            v1s.append(v)
    if t is None or not v1s:
        return False
    try:
        if abs(int(time.time()) - int(t)) > TOLERANCE:
            return False
    except ValueError:
        return False
    expected = hmac.new(SIGNING_SECRET, f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, c) for c in v1s)

@app.post("/api/v1/trustee/events")
def receive():
    raw = request.get_data()  # raw bytes — verify over these, not the parsed JSON
    if not verify(raw, request.headers.get("X-Payment-Signature")):
        return "bad signature", 400

    event_id = request.headers["X-Payment-Id"]
    if event_id in applied:
        return "duplicate ignored", 200

    applied.add(event_id)
    enqueue_for_processing(request.get_json())  # async worker
    return "ok", 200

def enqueue_for_processing(event):
    # event["type"], event["data"]["payment"][...]
    ...
```

---

## Test it

1. Register the endpoint in Dashboard → **Webhooks** and copy the signing
   secret into `PAYKH_WEBHOOK_SECRET`.
2. Click **Send test** — a synthetic `payment.completed` fires immediately.
3. Watch the delivery in the endpoint's **Deliveries** log: expand a row to see
   the HTTP code, your response body, any error, and the next-retry time.
4. If early attempts failed and dead-lettered before your receiver was live, use
   **Replay all dead-lettered** (or **Resend** on a single row) to flush them.

## Common pitfalls

- **Verifying over parsed-then-reserialized JSON.** Key order and whitespace
  change, so the HMAC won't match. Always hash the **raw** received bytes.
- **A body parser consuming the stream first.** Capture the raw body in the
  parser hook (Express `verify`) or read it before parsing.
- **Doing slow work before responding.** The 10s timeout counts as a failure and
  triggers retries (and eventually auto-disable). ACK first, process after.
- **Not deduping.** Retries and rare double-deliveries mean the same
  `X-Payment-Id` can arrive more than once.
