import { LedgerService } from './ledger.service';

/**
 * Exercise the contra-account routing of `postPointsMovement` by capturing what
 * it hands to `post()`. The liability leg is what the drift check reads; the
 * contra leg is what keeps expense / settled / breakage honest.
 */
function make() {
  const svc = new LedgerService({} as never);
  const post = jest.spyOn(svc, 'post').mockResolvedValue(undefined);
  return { svc, post };
}

type Line = { accountCode: string; direction: string; amount: { toNumber(): number }; customerId?: string };
const lineFor = (post: jest.SpyInstance, account: string): Line | undefined =>
  (post.mock.calls[0][4] as Line[]).find((l) => l.accountCode === account);

describe('postPointsMovement contra routing', () => {
  it('earn credits the liability against points_expense', async () => {
    const { svc, post } = make();
    await svc.postPointsMovement('EARN', 'pts_1', 's1', 'c1', 100);
    expect(post.mock.calls[0][0]).toBe('points.earn');
    expect(lineFor(post, 'points_liability')).toMatchObject({ direction: 'CREDIT', customerId: 'c1' });
    expect(lineFor(post, 'points_expense')).toMatchObject({ direction: 'DEBIT' });
  });

  it('redeem debits the liability against points_settled', async () => {
    const { svc, post } = make();
    await svc.postPointsMovement('REDEEM', 'pts_2', 's1', 'c1', -40);
    expect(lineFor(post, 'points_liability')).toMatchObject({ direction: 'DEBIT' });
    expect(lineFor(post, 'points_settled')).toMatchObject({ direction: 'CREDIT' });
  });

  it('expire debits the liability against points_breakage', async () => {
    const { svc, post } = make();
    await svc.postPointsMovement('EXPIRE', 'pts_3', 's1', 'c1', -25);
    expect(lineFor(post, 'points_breakage')).toMatchObject({ direction: 'CREDIT' });
  });

  it('a cancelled redemption unwinds points_settled, not points_expense', async () => {
    // Booking this to points_expense would leave points_settled claiming a
    // redemption that was handed back — overstating both, forever.
    const { svc, post } = make();
    await svc.postPointsMovement('REDEEM_REVERSAL', 'pts_4', 's1', 'c1', 40);
    expect(post.mock.calls[0][0]).toBe('points.redeem_reversal');
    expect(lineFor(post, 'points_liability')).toMatchObject({ direction: 'CREDIT' });
    expect(lineFor(post, 'points_settled')).toMatchObject({ direction: 'DEBIT' });
    expect(lineFor(post, 'points_expense')).toBeUndefined();
  });

  it('an adjust-down is breakage, not a settled redemption', async () => {
    const { svc, post } = make();
    await svc.postPointsMovement('ADJUST', 'pts_5', 's1', 'c1', -10);
    expect(lineFor(post, 'points_breakage')).toMatchObject({ direction: 'CREDIT' });
    expect(lineFor(post, 'points_settled')).toBeUndefined();
  });

  it('only the liability leg carries the customer', async () => {
    // Per-customer balances must sum to the account balance by construction;
    // a customerId on the contra leg would double-count in the drift check.
    const { svc, post } = make();
    await svc.postPointsMovement('EARN', 'pts_6', 's1', 'c1', 100);
    expect(lineFor(post, 'points_expense')?.customerId).toBeUndefined();
  });

  it('is a no-op for a zero movement', async () => {
    const { svc, post } = make();
    await svc.postPointsMovement('EARN', 'pts_7', 's1', 'c1', 0);
    expect(post).not.toHaveBeenCalled();
  });

  it('posts the magnitude, never a negative amount', async () => {
    const { svc, post } = make();
    await svc.postPointsMovement('REDEEM', 'pts_8', 's1', 'c1', -40);
    expect(lineFor(post, 'points_liability')?.amount.toNumber()).toBe(40);
  });
});
