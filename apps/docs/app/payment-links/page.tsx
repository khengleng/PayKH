import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'Payment links & invoices' };

export default function Page() {
  return (
    <>
      <h1>Payment links &amp; invoices</h1>
      <p>
        Payment links let you collect a payment without writing any checkout code — share a URL, and the
        customer pays on a hosted page. Ideal for invoices, social selling, and one-off charges.
      </p>

      <h2>Create a link</h2>
      <CodeBlock
        lang="bash"
        title="POST /links"
        code={`curl https://api.paykh.cambobia.com/links \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "25.00",
    "currency": "USD",
    "title": "Invoice #1042",
    "type": "invoice"
  }'`}
      />
      <CodeBlock
        lang="json"
        title="Response"
        code={`{
  "id": "lnk_8Q2b...",
  "url": "https://checkout.paykh.cambobia.com/l/lnk_8Q2b...",
  "amount": "25.00",
  "currency": "USD",
  "status": "active"
}`}
      />

      <h2>Share it</h2>
      <p>Send the <code>url</code> to your customer. When they open it, PayKH mints a payment and shows the KHQR. Single-use links close automatically after they&rsquo;re paid.</p>

      <Callout tone="info" title="No-code option">
        You can also create links visually in the <a href="https://paykh.cambobia.com">dashboard</a> under
        <strong> Payment links</strong> — no API call required.
      </Callout>

      <h2>Receipts</h2>
      <p>
        When a linked (or any) payment completes, the customer can view a hosted receipt at{' '}
        <code>/r/&#123;payment_id&#125;</code>, and an email receipt is sent if you&rsquo;ve configured email.
      </p>

      <PageNav prev={{ title: 'Payments', href: '/payments' }} next={{ title: 'Refunds', href: '/refunds' }} />
    </>
  );
}
