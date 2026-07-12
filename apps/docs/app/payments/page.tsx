import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'Payments' };

export default function Page() {
  return (
    <>
      <h1>Payments</h1>
      <p>A payment represents a single KHQR charge. It moves through a strict lifecycle from creation to a terminal state.</p>

      <h2>Lifecycle</h2>
      <CodeBlock
        lang="text"
        title="State machine"
        code={`pending ──▶ scanned ──▶ paid          (terminal)
   │           │
   ├───────────┴──▶ expired            (terminal)
   ├──────────────▶ failed             (terminal)
   └──────────────▶ cancelled          (terminal)

paid ──▶ refunded / partially_refunded`}
      />
      <p>Transitions are one-way — a terminal payment never changes state (except a paid payment being refunded).</p>

      <h2>Create a payment</h2>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>amount</code></td><td>string</td><td>Required. Decimal string, e.g. <code>&quot;1.50&quot;</code>.</td></tr>
          <tr><td><code>currency</code></td><td>string</td><td>Required. <code>USD</code> or <code>KHR</code>.</td></tr>
          <tr><td><code>reference_id</code></td><td>string</td><td>Your order id. Returned on the payment and in webhooks.</td></tr>
          <tr><td><code>description</code></td><td>string</td><td>Optional. Shown on checkout / receipts.</td></tr>
          <tr><td><code>expires_in</code></td><td>number</td><td>Optional. Seconds until expiry (default set by the provider).</td></tr>
          <tr><td><code>metadata</code></td><td>object</td><td>Optional. Key/value pairs echoed back to you.</td></tr>
        </tbody>
      </table>
      <CodeBlock
        lang="bash"
        title="POST /v1/payments"
        code={`curl https://api.paykh.cambobia.com/v1/payments \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order_1001" \\
  -d '{ "amount": "12.00", "currency": "USD", "reference_id": "order_1001" }'`}
      />

      <Callout tone="info" title="Idempotency">
        Send an <code>Idempotency-Key</code> header on create. Retrying with the same key returns the original
        payment instead of creating a duplicate — safe against network retries. A conflicting reuse returns{' '}
        <code>409 idempotency_conflict</code>.
      </Callout>

      <h2>Retrieve, list, cancel</h2>
      <CodeBlock
        lang="bash"
        title="curl"
        code={`# Retrieve one
curl https://api.paykh.cambobia.com/v1/payments/pay_123 \\
  -H "Authorization: Bearer bk_test_your_key"

# List (paginated)
curl "https://api.paykh.cambobia.com/v1/payments?limit=20" \\
  -H "Authorization: Bearer bk_test_your_key"

# Cancel a still-pending payment
curl -X POST https://api.paykh.cambobia.com/v1/payments/pay_123/cancel \\
  -H "Authorization: Bearer bk_test_your_key"`}
      />

      <h2>Getting notified</h2>
      <p>
        Don&rsquo;t poll in production. Register a <a href="/webhooks">webhook</a> and react to{' '}
        <code>payment.completed</code>. For a live UI, the hosted checkout page streams status over SSE.
      </p>

      <PageNav prev={{ title: 'Test mode & sandbox', href: '/testing' }} next={{ title: 'Payment links & invoices', href: '/payment-links' }} />
    </>
  );
}
