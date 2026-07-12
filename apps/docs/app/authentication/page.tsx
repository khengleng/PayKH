import { CodeBlock } from '../../components/CodeBlock';
import { Callout, PageNav } from '../../components/ui';

export const metadata = { title: 'Authentication' };

export default function Page() {
  return (
    <>
      <h1>Authentication</h1>
      <p>
        The PayKH API authenticates with a secret API key sent as a Bearer token. Each key belongs to one
        store and one mode.
      </p>

      <CodeBlock lang="bash" title="Authorization header" code={`Authorization: Bearer bk_live_xxxxxxxxxxxxxxxxxxxxx`} />

      <h2>Test vs live keys</h2>
      <table>
        <thead><tr><th>Prefix</th><th>Mode</th><th>Behaviour</th></tr></thead>
        <tbody>
          <tr><td><code>bk_test_</code></td><td>Test</td><td>No real money. Use <a href="/testing">simulate</a> to drive outcomes.</td></tr>
          <tr><td><code>bk_live_</code></td><td>Live</td><td>Real Bakong settlement. Available once your account is activated.</td></tr>
        </tbody>
      </table>
      <p>The mode is determined by the key, not the URL — the base URL is always the same.</p>

      <h2>Creating &amp; managing keys</h2>
      <p>
        Create keys in the <a href="https://paykh.cambobia.com">dashboard</a> under a store&rsquo;s{' '}
        <strong>API keys</strong> tab. You can label, rotate, and revoke keys there. The full secret is shown
        only once — only a prefix is stored, so a leaked key is revoked, never recovered.
      </p>
      <Callout tone="warn" title="Never expose secret keys">
        Secret keys grant full access to a store&rsquo;s payments. Keep them server-side, in environment
        variables or a secrets manager. If a key leaks, rotate it immediately from the dashboard.
      </Callout>

      <h2>Roles &amp; permissions</h2>
      <p>
        Dashboard access is governed by team roles — <strong>Owner</strong>, <strong>Developer</strong>, and{' '}
        <strong>Analyst</strong> — plus attribute-based rules (e.g. minting a <code>bk_live_</code> key requires
        the Owner role). API keys themselves always act with full store scope.
      </p>

      <h2>Rate limits</h2>
      <table>
        <thead><tr><th>Scope</th><th>Limit</th></tr></thead>
        <tbody>
          <tr><td><code>/v1/*</code> per API key</td><td>100 requests / 10 seconds</td></tr>
          <tr><td>Auth endpoints per IP</td><td>10 requests / 60 seconds</td></tr>
        </tbody>
      </table>
      <p>Exceeding a limit returns <code>429</code> with error code <code>rate_limit_exceeded</code>.</p>

      <PageNav prev={{ title: 'Quickstart', href: '/quickstart' }} next={{ title: 'Test mode & sandbox', href: '/testing' }} />
    </>
  );
}
