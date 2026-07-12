import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'Webhooks' };

export default function Page() {
  return (
    <>
      <h1>Webhooks</h1>
      <p>
        Webhooks push events to your server the instant something happens — most importantly, when a payment
        completes. Register endpoints in the <a href="https://paykh.cambobia.com">dashboard</a> under{' '}
        <strong>Webhooks</strong>, choose which events to receive, and view/replay deliveries.
      </p>

      <h2>Events</h2>
      <table>
        <thead><tr><th>Event</th><th>Fires when</th></tr></thead>
        <tbody>
          <tr><td><code>payment.created</code></td><td>A payment is created.</td></tr>
          <tr><td><code>payment.scanned</code></td><td>The customer opens/scans the QR.</td></tr>
          <tr><td><code>payment.completed</code></td><td>Payment is paid. <strong>The one most integrations act on.</strong></td></tr>
          <tr><td><code>payment.failed</code></td><td>Payment failed.</td></tr>
          <tr><td><code>payment.expired</code></td><td>Payment expired before payment.</td></tr>
          <tr><td><code>payment.cancelled</code></td><td>Payment was cancelled.</td></tr>
          <tr><td><code>payment.refunded</code></td><td>A full or partial refund was issued.</td></tr>
        </tbody>
      </table>

      <h2>Delivery headers</h2>
      <CodeBlock
        lang="http"
        title="Request headers"
        code={`X-Payment-Event: payment.completed
X-Payment-Id: evt_9f8c...          (event id — use for idempotency)
X-Payment-Signature: t=1783683255,v1=6f1c...e2`}
      />

      <h2>Verifying signatures</h2>
      <p>
        Every delivery is signed. <code>v1</code> is <code>HMAC-SHA256(signing_secret, &quot;&#123;timestamp&#125;.&#123;rawBody&#125;&quot;)</code>{' '}
        in hex, where <code>rawBody</code> is the exact bytes you received. Reject requests whose timestamp is
        more than <strong>5 minutes</strong> old (replay protection) or whose signature doesn&rsquo;t match.
      </p>
      <Callout tone="warn" title="Verify against the raw body">
        Compute the HMAC over the raw request bytes, before any JSON parsing/re-serialization — re-encoding changes the bytes and breaks the signature.
      </Callout>

      <CodeBlock
        lang="javascript"
        title="Node.js (Express)"
        code={`import crypto from 'node:crypto';

// Mount with the raw body: app.use('/webhooks', express.raw({ type: '*/*' }))
app.post('/webhooks/paykh', (req, res) => {
  const raw = req.body.toString('utf8');
  const header = req.header('X-Payment-Signature') || '';
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto
    .createHmac('sha256', process.env.PAYKH_WEBHOOK_SECRET)
    .update(parts.t + '.' + raw)
    .digest('hex');

  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 || ''));
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) <= 300;
  if (!ok || !fresh) return res.status(400).end();

  const event = JSON.parse(raw);
  // Idempotent on the event id (X-Payment-Id header):
  if (event.type === 'payment.completed') fulfillOrder(event.data.reference_id);
  res.status(200).end();
});`}
      />
      <CodeBlock
        lang="python"
        title="Python (Flask)"
        code={`import hmac, hashlib, time, os
from flask import request, abort

@app.post("/webhooks/paykh")
def paykh_webhook():
    raw = request.get_data()  # exact bytes
    header = request.headers.get("X-Payment-Signature", "")
    parts = dict(p.split("=", 1) for p in header.split(","))
    expected = hmac.new(os.environ["PAYKH_WEBHOOK_SECRET"].encode(),
                        (parts["t"] + ".").encode() + raw,
                        hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, parts.get("v1", "")):
        abort(400)
    if abs(time.time() - int(parts["t"])) > 300:
        abort(400)
    # process request.json ...
    return "", 200`}
      />
      <p>
        The official <a href="/sdks">SDKs</a> ship a <code>verifySignature()</code> helper so you don&rsquo;t
        implement this by hand.
      </p>

      <h2>Reliability</h2>
      <ul>
        <li><strong>At-least-once</strong> delivery with automatic retries and backoff — make your handler idempotent on the event id.</li>
        <li>Failing endpoints are retried; persistent failures are logged and can auto-disable.</li>
        <li>Rotate the signing secret from the dashboard — the old secret stays valid for 24h.</li>
        <li>Return <code>2xx</code> quickly; do slow work asynchronously.</li>
      </ul>

      <PageNav prev={{ title: 'Refunds', href: '/refunds' }} next={{ title: 'Errors', href: '/errors' }} />
    </>
  );
}
