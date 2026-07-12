import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'SDKs' };

export default function Page() {
  return (
    <>
      <h1>SDKs</h1>
      <p>Official libraries wrap authentication, requests, errors, and webhook verification so you write less boilerplate.</p>

      <h2>Node.js</h2>
      <CodeBlock lang="bash" title="Install" code={`npm install @paykh/sdk-node`} />
      <CodeBlock
        lang="javascript"
        title="Usage"
        code={`import { PayKH } from '@paykh/sdk-node';

const paykh = new PayKH(process.env.PAYKH_API_KEY); // bk_test_… / bk_live_…

const payment = await paykh.payments.create({
  amount: '1.50',
  currency: 'USD',
  reference_id: 'order_1001',
});
console.log(payment.qr_string);`}
      />
      <p>Webhook verification:</p>
      <CodeBlock
        lang="javascript"
        title="Verify a webhook"
        code={`import { verifyWebhook, constructEvent } from '@paykh/sdk-node';

const event = constructEvent(rawBody, signatureHeader, process.env.PAYKH_WEBHOOK_SECRET);
if (event.type === 'payment.completed') { /* fulfil */ }`}
      />

      <h2>PHP</h2>
      <CodeBlock lang="bash" title="Install" code={`composer require paykh/sdk-php`} />
      <CodeBlock
        lang="php"
        title="Usage"
        code={`<?php
use PayKH\\Client;

$paykh = new Client(getenv('PAYKH_API_KEY'));
$payment = $paykh->payments->create([
  'amount' => '1.50',
  'currency' => 'USD',
  'reference_id' => 'order_1001',
]);
echo $payment['qr_string'];`}
      />

      <h2>Python</h2>
      <CodeBlock lang="bash" title="Install" code={`pip install paykh`} />
      <CodeBlock
        lang="python"
        title="Usage"
        code={`from paykh import PayKH

paykh = PayKH(api_key=os.environ["PAYKH_API_KEY"])
payment = paykh.payments.create(
    amount="1.50",
    currency="USD",
    reference_id="order_1001",
)
print(payment["qr_string"])`}
      />

      <Callout tone="info" title="Prefer HTTP?">
        Every SDK is a thin wrapper over the REST API. If your language isn&rsquo;t listed, the{' '}
        <a href="/api-reference">API reference</a> and a <a href="https://api.paykh.cambobia.com/docs">Postman collection</a> have you covered.
      </Callout>

      <PageNav prev={{ title: 'API reference', href: '/api-reference' }} next={{ title: 'Changelog', href: '/changelog' }} />
    </>
  );
}
