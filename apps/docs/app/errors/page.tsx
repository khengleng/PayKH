import { CodeBlock } from '../../components/CodeBlock';
import { PageNav } from '../../components/ui';

export const metadata = { title: 'Errors' };

export default function Page() {
  return (
    <>
      <h1>Errors</h1>
      <p>Every error returns a consistent JSON envelope and a matching HTTP status. Stack traces are never leaked.</p>

      <CodeBlock
        lang="json"
        title="Error envelope"
        code={`{
  "error": "invalid_request",
  "message": "amount must be a positive decimal string",
  "request_id": "req_7s1jH9nRqYRvLW1U4K6x"
}`}
      />
      <p>Always log <code>request_id</code> — quote it in support requests to trace the exact call.</p>

      <h2>Error codes</h2>
      <table>
        <thead><tr><th>HTTP</th><th><code>error</code></th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>400</td><td><code>invalid_request</code></td><td>Malformed or invalid parameters.</td></tr>
          <tr><td>401</td><td><code>unauthorized</code></td><td>Missing, invalid, or revoked API key.</td></tr>
          <tr><td>402</td><td><code>quota_exceeded</code></td><td>Plan quota reached — upgrade or wait for the next period.</td></tr>
          <tr><td>403</td><td><code>forbidden</code></td><td>Authenticated but not allowed (role/ABAC).</td></tr>
          <tr><td>404</td><td><code>payment_not_found</code></td><td>The resource doesn&rsquo;t exist or isn&rsquo;t in your scope.</td></tr>
          <tr><td>409</td><td><code>idempotency_conflict</code></td><td>An <code>Idempotency-Key</code> was reused with a different payload.</td></tr>
          <tr><td>429</td><td><code>rate_limit_exceeded</code></td><td>Too many requests — back off and retry.</td></tr>
          <tr><td>5xx</td><td><code>internal_error</code></td><td>Something went wrong on our side. Safe to retry idempotently.</td></tr>
          <tr><td>502</td><td><code>provider_error</code></td><td>The upstream Bakong provider returned an error.</td></tr>
        </tbody>
      </table>

      <h2>Handling errors well</h2>
      <ul>
        <li>Retry <code>429</code> and <code>5xx</code> with exponential backoff; always send an <code>Idempotency-Key</code> on creates so retries are safe.</li>
        <li>Treat <code>4xx</code> (except 429) as terminal — fix the request, don&rsquo;t retry.</li>
        <li>Surface <code>message</code> to your developers, not end users; show a generic message to customers.</li>
      </ul>

      <PageNav prev={{ title: 'Webhooks', href: '/webhooks' }} next={{ title: 'API reference', href: '/api-reference' }} />
    </>
  );
}
