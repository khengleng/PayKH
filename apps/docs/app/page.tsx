import { Cards, LinkCard, PageNav } from '../components/ui';
import { CodeBlock } from '../components/CodeBlock';

export default function Home() {
  return (
    <>
      <div className="not-prose mb-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          Bakong KHQR · Cambodia
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900">PayKH Developer Docs</h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-500">
          Accept Bakong KHQR payments with a single API call. Create a payment, show the QR, get
          notified the instant it&rsquo;s paid — in test mode today, live once your account is activated.
        </p>
      </div>

      <p>
        PayKH is a payment gateway for Cambodia built on the National Bank of Cambodia&rsquo;s{' '}
        <strong>Bakong</strong> network. You integrate once with a clean REST API and get hosted
        checkout, payment links, webhooks, refunds, settlement, and a merchant dashboard.
      </p>

      <h2>Create your first payment</h2>
      <p>Every payment is one <code>POST</code>. The response includes a KHQR string you render for the customer.</p>
      <CodeBlock
        lang="bash"
        title="curl"
        code={`curl https://api.paykh.cambobia.com/v1/payments \\
  -H "Authorization: Bearer bk_test_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": "1.50", "currency": "USD", "reference_id": "order_1001" }'`}
      />

      <h2>Where to go next</h2>
      <Cards>
        <LinkCard href="/quickstart" title="Quickstart" desc="Go from zero to a paid test payment in five minutes." />
        <LinkCard href="/authentication" title="Authentication" desc="API keys, test vs live mode, and how to keep secrets safe." />
        <LinkCard href="/payments" title="Payments" desc="The payment lifecycle, KHQR, and status polling." />
        <LinkCard href="/webhooks" title="Webhooks" desc="Get notified the moment a payment is completed." />
        <LinkCard href="/api-reference" title="API reference" desc="Every endpoint, live from the OpenAPI spec." />
        <LinkCard href="/sdks" title="SDKs" desc="Official libraries for Node.js, PHP, and Python." />
      </Cards>

      <h2>Base URL</h2>
      <p>All API requests go to a single base URL. Test and live are selected by your API key, not the URL.</p>
      <CodeBlock lang="text" title="Base URL" code={`https://api.paykh.cambobia.com`} />

      <PageNav next={{ title: 'Quickstart', href: '/quickstart' }} />
    </>
  );
}
