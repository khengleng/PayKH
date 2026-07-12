import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'Quickstart' };

export default function Page() {
  return (
    <>
      <h1>Quickstart</h1>
      <p>Create a paid test payment in five minutes. You&rsquo;ll need a PayKH account and a test API key.</p>

      <h2>1. Get a test API key</h2>
      <p>
        Sign in to the <a href="https://paykh.cambobia.com">dashboard</a>, open a store, go to{' '}
        <strong>API keys</strong>, and create a key in <strong>test</strong> mode. Test keys start with{' '}
        <code>bk_test_</code> and never move real money.
      </p>
      <Callout tone="warn" title="Keep your secret safe">
        The full key is shown only once at creation. Store it in an environment variable — never commit it or expose it in front-end code.
      </Callout>

      <h2>2. Create a payment</h2>
      <p>Send the amount as a decimal string. The response contains a <code>qr_string</code> (the KHQR payload) you render for the customer.</p>
      <CodeBlock
        lang="bash"
        title="curl"
        code={`curl https://api.paykh.cambobia.com/v1/payments \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "1.50",
    "currency": "USD",
    "reference_id": "order_1001",
    "description": "Cappuccino"
  }'`}
      />
      <CodeBlock
        lang="json"
        title="201 Created"
        code={`{
  "id": "pay_JuBodnQ6Pm1DbHYCP3v77YbH",
  "status": "pending",
  "amount": "1.50",
  "currency": "USD",
  "reference_id": "order_1001",
  "qr_string": "00020101021229...6304AB12",
  "expires_at": "2026-07-12T09:30:00.000Z"
}`}
      />

      <h2>3. Show the KHQR</h2>
      <p>
        Render <code>qr_string</code> as a QR code with any QR library, or send the customer to the{' '}
        <strong>hosted checkout</strong> page which renders it, shows a live status, and handles expiry for you:
      </p>
      <CodeBlock lang="text" title="Hosted checkout" code={`https://checkout.paykh.cambobia.com/pay/pay_JuBodnQ6Pm1DbHYCP3v77YbH`} />

      <h2>4. Simulate payment (test mode)</h2>
      <p>In test mode there&rsquo;s no real bank, so you drive the outcome yourself:</p>
      <CodeBlock
        lang="bash"
        title="curl"
        code={`curl https://api.paykh.cambobia.com/v1/payments/pay_JuBodnQ6Pm1DbHYCP3v77YbH/simulate \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "paid" }'`}
      />

      <h2>5. Confirm the status</h2>
      <CodeBlock
        lang="bash"
        title="curl"
        code={`curl https://api.paykh.cambobia.com/v1/payments/pay_JuBodnQ6Pm1DbHYCP3v77YbH \\
  -H "Authorization: Bearer bk_test_your_key"`}
      />
      <p>
        You&rsquo;ll see <code>&quot;status&quot;: &quot;paid&quot;</code>. In production you don&rsquo;t poll —
        you receive a <a href="/webhooks">webhook</a> the instant the payment completes.
      </p>

      <Callout tone="success" title="That's the full loop">
        Create → show QR → get paid → confirm. Everything else (links, refunds, webhooks, settlement) builds on this.
      </Callout>

      <PageNav prev={{ title: 'Introduction', href: '/' }} next={{ title: 'Authentication', href: '/authentication' }} />
    </>
  );
}
