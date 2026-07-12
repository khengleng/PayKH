import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'Refunds' };

export default function Page() {
  return (
    <>
      <h1>Refunds</h1>
      <p>Refund all or part of a completed payment. Refunds are posted to the ledger and can be issued multiple times up to the paid amount.</p>

      <h2>Full refund</h2>
      <p>Omit <code>amount</code> to refund the entire remaining balance.</p>
      <CodeBlock
        lang="bash"
        title="POST /v1/payments/:id/refund"
        code={`curl https://api.paykh.cambobia.com/v1/payments/pay_123/refund \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "reason": "customer request" }'`}
      />

      <h2>Partial refund</h2>
      <p>Pass an <code>amount</code> to refund part of the payment. Repeat until the full amount is refunded.</p>
      <CodeBlock
        lang="bash"
        title="curl"
        code={`curl https://api.paykh.cambobia.com/v1/payments/pay_123/refund \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": "5.00", "reason": "partial" }'`}
      />

      <p>List a payment&rsquo;s refunds:</p>
      <CodeBlock
        lang="bash"
        title="GET /v1/payments/:id/refunds"
        code={`curl https://api.paykh.cambobia.com/v1/payments/pay_123/refunds \\
  -H "Authorization: Bearer bk_test_your_key"`}
      />

      <Callout tone="warn" title="High-value refunds">
        For risk control, high-value refunds may require an Owner (not Analyst) and can be gated behind MFA.
        A refund larger than the remaining balance is rejected with <code>invalid_request</code>.
      </Callout>

      <p>
        A refund moves the payment to <code>partially_refunded</code> or <code>refunded</code> and fires a{' '}
        <code>payment.refunded</code> <a href="/webhooks">webhook</a>.
      </p>

      <PageNav prev={{ title: 'Payment links & invoices', href: '/payment-links' }} next={{ title: 'Webhooks', href: '/webhooks' }} />
    </>
  );
}
