import { AlertService } from './alert.service';

/**
 * Build the service over a fixed settings map. `fetch` is stubbed so the
 * Telegram channel is observable without leaving the process.
 */
function make(settings: Record<string, string | undefined>) {
  const resolve = jest.fn((key: string) => Promise.resolve(settings[key]));
  const send = jest.fn().mockResolvedValue(undefined);
  const svc = new AlertService({ resolve } as never, { send } as never);
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  global.fetch = fetchMock as never;
  return { svc, send, fetchMock };
}

const WIRED = {
  telegram_bot_token: 'bot-token',
  alert_telegram_chat_id: '-100123',
  alert_email: 'ops@example.com',
};

describe('AlertService channel gating', () => {
  it('defaults to Telegram only — no email, even with an alert address set', async () => {
    // The reason this default exists: every ops alert used to also hit the
    // inbox, so `alert_email` being set was enough to duplicate it.
    const { svc, send, fetchMock } = make(WIRED);
    await svc.critical('Loyalty points ledger drift', '3 customer(s) disagree');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends email only when the channel is explicitly switched on', async () => {
    const { svc, send, fetchMock } = make({ ...WIRED, alert_channels: 'telegram,email' });
    await svc.critical('Payout failed', 'payout_1 failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'ops@example.com', subject: '[PayKH alert] Payout failed' });
  });

  it('honours an explicit empty value as log + Sentry only', async () => {
    const { svc, send, fetchMock } = make({ ...WIRED, alert_channels: '' });
    await svc.critical('Payout failed', 'payout_1 failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('tolerates spacing and case in the channel list', async () => {
    const { svc, send } = make({ ...WIRED, alert_channels: ' Email , TELEGRAM ' });
    await svc.critical('Payout failed', 'payout_1 failed');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('an enabled channel with no target still sends nothing', async () => {
    const { svc, send } = make({ ...WIRED, alert_email: undefined, alert_channels: 'email' });
    await svc.critical('Payout failed', 'payout_1 failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('dedupes an identical alert within the window', async () => {
    const { svc, fetchMock } = make(WIRED);
    await svc.critical('Loyalty points ledger drift', 'same detail');
    await svc.critical('Loyalty points ledger drift', 'same detail');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a configured-but-disabled channel as not delivering', async () => {
    // `alert_email` is set, so the old report said email: true while the
    // channel was off — the check has to be the conjunction.
    const { svc } = make(WIRED);
    const r = await svc.test();
    expect(r.channels).toMatchObject({ telegram: true, email: false });
    expect(r.enabled_channels).toEqual(['telegram']);
  });
});
