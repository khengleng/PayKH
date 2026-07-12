import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'Test mode & sandbox' };

export default function Page() {
  return (
    <>
      <h1>Test mode &amp; sandbox</h1>
      <p>
        Every account can build and test end-to-end before going live. Test mode uses a mock Bakong provider,
        so no real money moves and you control every outcome.
      </p>

      <h2>Enabling test mode</h2>
      <p>Use a <code>bk_test_</code> key. All resources created with a test key are isolated from live data.</p>

      <h2>Simulating outcomes</h2>
      <p>
        Because there&rsquo;s no real bank in test mode, drive a payment through its lifecycle with the{' '}
        <code>simulate</code> endpoint:
      </p>
      <CodeBlock
        lang="bash"
        title="POST /v1/payments/:id/simulate"
        code={`curl https://api.paykh.cambobia.com/v1/payments/pay_123/simulate \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "paid" }'`}
      />
      <table>
        <thead><tr><th><code>status</code></th><th>Effect</th></tr></thead>
        <tbody>
          <tr><td><code>scanned</code></td><td>Customer opened the QR (fires <code>payment.scanned</code>).</td></tr>
          <tr><td><code>paid</code></td><td>Payment completes (fires <code>payment.completed</code>).</td></tr>
          <tr><td><code>failed</code></td><td>Payment fails (fires <code>payment.failed</code>).</td></tr>
          <tr><td><code>expired</code></td><td>Payment expires (fires <code>payment.expired</code>).</td></tr>
        </tbody>
      </table>
      <Callout tone="info" title="Webhooks fire in test mode">
        Simulated transitions dispatch the same webhooks as production — the perfect way to test your webhook handler end-to-end.
      </Callout>

      <h2>Going live</h2>
      <p>
        Once your account is activated for Bakong, switch to a <code>bk_live_</code> key. No code changes are
        needed beyond the key — the base URL and request shapes are identical. In live mode the{' '}
        <code>simulate</code> endpoint is disabled; real customer scans drive the state instead.
      </p>

      <PageNav prev={{ title: 'Authentication', href: '/authentication' }} next={{ title: 'Payments', href: '/payments' }} />
    </>
  );
}
