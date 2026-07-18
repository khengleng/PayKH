import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { requirePermission } from '../auth/rbac';
import { parseKhqr, buildBakongKhqr } from '../providers/khqr.util';
import { BakongAccount, Currency, currenciesOf, readAccounts, withAccount } from '../providers/bakong-credential';
import { Payee, payeeFromAccount } from '../providers/payee-display';

export class ImportKhqrDto {
  /** The raw KHQR payload, e.g. decoded from the QR the merchant's bank issued. */
  @IsString() @MinLength(12) @MaxLength(1024) qr_string!: string;
  @IsOptional() @IsIn(['test', 'live']) mode?: 'test' | 'live';
  /** Only needed when the QR itself does not state a currency (rare). */
  @IsOptional() @IsIn(['USD', 'KHR']) currency?: Currency;
}

/**
 * "Bring your own bank account."
 *
 * A merchant exports the KHQR their bank already gave them; PayKH reads the
 * Bakong account id out of it and reissues dynamic QRs — same account, our
 * amount — for each payment.
 *
 * The point is that this needs no relationship with the merchant's bank: a KHQR
 * payload is built offline (EMVCo TLV + CRC), and the Bakong account id is what
 * routes the money. So any bank works, and PayKH is never onboarded by any of
 * them.
 *
 * It also solves a UX problem: the Bakong account id lives *inside* the QR, not
 * on the card. Asking a merchant to type it would mostly yield their account
 * number, which is a different thing and would not route.
 */
@Injectable()
export class KhqrImportService {
  private readonly logger = new Logger('KhqrImport');

  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'store:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  /**
   * Validate an uploaded KHQR and store the account it names.
   *
   * The payload is attacker-supplied, so parseKhqr proves the CRC before any
   * field is believed. We keep only what identifies the payee — never the
   * original amount, which is meaningless once we reissue.
   */
  async import(user: AuthUser, storeId: string, dto: ImportKhqrDto) {
    await this.assertStore(user, storeId, 'store:write');
    const mode = dto.mode ?? 'test';

    let parsed: ReturnType<typeof parseKhqr>;
    try {
      parsed = parseKhqr(dto.qr_string);
    } catch (e) {
      // Surface the real reason: "not a Bakong account id" vs "checksum
      // mismatch" tell the merchant completely different things to do.
      throw ApiError.invalidRequest(`Could not read that KHQR — ${e instanceof Error ? e.message : 'unknown error'}`);
    }

    // Route by the currency the bank's QR declared (tag 53). A store keeps one
    // account per currency — Wing issues separate KHR/USD accounts — so we must
    // know which this is. A rare QR without a currency needs it stated.
    const currency = parsed.currency ?? dto.currency;
    if (!currency) {
      throw ApiError.invalidRequest('This KHQR does not state a currency — choose USD or KHR for it.');
    }

    const account = {
      bakongAccountId: parsed.bakongAccountId,
      // The payee's account/phone from tag 29 sub-tag 01. Banks surface this as
      // the "receiver account" and at least one refuses a QR without it, so it
      // must survive the round trip.
      accountInformation: parsed.accountInformation,
      merchantName: parsed.merchantName,
      merchantCity: parsed.merchantCity ?? 'Phnom Penh',
      merchantId: parsed.merchantId,
      acquiringBank: parsed.acquiringBank,
      isMerchant: parsed.isMerchant,
    };

    // Prove we can reissue against this account BEFORE saving it. A credential
    // that stores cleanly but cannot produce a scannable QR would surface as a
    // failed checkout in front of a customer. Static (no amount), like the QR
    // the bank issued — the payer types the figure.
    const probe = buildBakongKhqr({
      bakongAccountId: account.bakongAccountId,
      accountInformation: account.accountInformation,
      merchantName: account.merchantName ?? 'Merchant',
      merchantCity: account.merchantCity,
      currency,
      merchantId: account.merchantId,
      acquiringBank: account.acquiringBank,
      isMerchant: account.isMerchant,
    });
    const reissued = parseKhqr(probe.qrString); // throws if we built something invalid
    if (reissued.bakongAccountId !== account.bakongAccountId) {
      throw ApiError.internal('Reissued QR does not name the imported account');
    }

    // Merge into any account already imported for the OTHER currency, so a store
    // can hold both its KHR and USD QR.
    const existing = await this.prisma.providerCredential.findUnique({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
    });
    let priorBlob: unknown = {};
    if (existing) {
      try { priorBlob = JSON.parse(this.crypto.decrypt(existing.secretCiphertext)); } catch { priorBlob = {}; }
    }
    const blob = withAccount(priorBlob, currency, account);
    const label = `KHQR import — ${currenciesOf(blob).sort().map((c) => `${c}:${blob.accounts[c]!.bakongAccountId}`).join(', ')}`;
    const ciphertext = this.crypto.encrypt(JSON.stringify(blob));
    await this.prisma.providerCredential.upsert({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
      create: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST', label, secretCiphertext: ciphertext },
      update: { label, secretCiphertext: ciphertext },
    });
    this.logger.log(`khqr imported for ${storeId} (${mode}) ${currency}: ${account.bakongAccountId}`);

    return {
      imported: true,
      mode,
      just_imported: currency,
      source_was_static: parsed.isStatic,
      accounts: this.summariseAccounts(blob.accounts),
      // Let the merchant confirm this is really their account before going live.
      sample_qr: probe.qrString,
    };
  }

  /**
   * Build a KHQR for the imported account at an arbitrary amount.
   *
   * Same path checkout will use, so what the merchant scans here is what a
   * customer would get. Amount is the caller's choice: an amount PayKH picked
   * is only useful for proving the account reads back, and a merchant testing
   * a real flow wants their own number.
   *
   * Omit the amount for a static QR — the payer types it in. That is what a
   * bank's own "receive" QR is, and it is the right shape for tips or
   * pay-what-you-want, where fixing the amount would be wrong.
   */
  /** Load the accounts blob for a store, or throw a friendly error. */
  private async loadAccounts(storeId: string, mode: 'test' | 'live') {
    const row = await this.prisma.providerCredential.findUnique({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
    });
    if (!row) return { row: null, accounts: {} as Partial<Record<Currency, BakongAccount>> };
    try {
      return { row, accounts: readAccounts(JSON.parse(this.crypto.decrypt(row.secretCiphertext))) };
    } catch {
      throw ApiError.invalidRequest('Stored credential could not be decrypted; re-import the KHQR.');
    }
  }

  /**
   * Build a KHQR for a chosen currency's imported account. Omit the amount for a
   * static QR (the payer types it) — the shape a POS counter needs so a bank app
   * can scan it directly.
   */
  async preview(user: AuthUser, storeId: string, amount: string | undefined, currency: Currency, mode: 'test' | 'live' = 'test') {
    await this.assertStore(user, storeId, 'store:read');
    const { accounts } = await this.loadAccounts(storeId, mode);
    const account = accounts[currency];
    if (!account) {
      const have = (Object.keys(accounts) as Currency[]).join(', ') || 'none';
      throw ApiError.invalidRequest(`No ${currency} account imported (imported: ${have}). Upload your ${currency} KHQR first.`);
    }
    if (amount !== undefined) {
      if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw ApiError.invalidRequest('Amount must be a number like "12.50"');
      if (Number(amount) <= 0) throw ApiError.invalidRequest('Amount must be greater than zero');
    }
    const { qrString, md5 } = buildBakongKhqr({
      bakongAccountId: account.bakongAccountId,
      accountInformation: account.accountInformation,
      merchantName: account.merchantName ?? 'Merchant',
      merchantCity: account.merchantCity ?? 'Phnom Penh',
      amount,
      currency,
      merchantId: account.merchantId,
      acquiringBank: account.acquiringBank,
      isMerchant: account.isMerchant,
    });
    return { qr_string: qrString, md5, amount: amount ?? null, currency, bakong_account_id: account.bakongAccountId, payee: payeeFromAccount(account) };
  }

  /**
   * The payer-facing "who you're paying" block (owner name + bank) for a
   * store's account in a given currency, or null if none is imported. Shared by
   * POS, the counter QR, and the hosted checkout so every surface names the
   * payee the same way.
   */
  async payeeFor(storeId: string, currency: Currency, mode: 'test' | 'live' = 'test'): Promise<Payee | null> {
    const { accounts } = await this.loadAccounts(storeId, mode);
    const account = accounts[currency];
    return account ? payeeFromAccount(account) : null;
  }

  async get(user: AuthUser, storeId: string, mode: 'test' | 'live' = 'test') {
    await this.assertStore(user, storeId, 'store:read');
    const row = await this.prisma.providerCredential.findUnique({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
    });
    if (!row) return { imported: false, mode };
    let accounts: Partial<Record<Currency, BakongAccount>>;
    try {
      accounts = readAccounts(JSON.parse(this.crypto.decrypt(row.secretCiphertext)));
    } catch {
      // ENCRYPTION_KEY rotation. Say so rather than 500 — re-importing fixes it.
      return { imported: true, mode, unreadable: true, detail: 'Stored credential could not be decrypted; re-import the KHQR.' };
    }
    return { imported: true, mode, accounts: this.summariseAccounts(accounts), updated_at: row.updatedAt };
  }

  /** Remove one currency's account, or all when no currency is given. */
  async remove(user: AuthUser, storeId: string, mode: 'test' | 'live' = 'test', currency?: Currency) {
    await this.assertStore(user, storeId, 'store:write');
    if (!currency) {
      await this.prisma.providerCredential.deleteMany({ where: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } });
      return { imported: false, mode };
    }
    const { row, accounts } = await this.loadAccounts(storeId, mode);
    if (!row) return { imported: false, mode };
    delete accounts[currency];
    if (Object.keys(accounts).length === 0) {
      await this.prisma.providerCredential.deleteMany({ where: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } });
      return { imported: false, mode };
    }
    await this.prisma.providerCredential.update({
      where: { id: row.id },
      data: { secretCiphertext: this.crypto.encrypt(JSON.stringify({ accounts })) },
    });
    return { imported: true, mode, accounts: this.summariseAccounts(accounts) };
  }

  /** One row per imported currency. The account id identifies where money lands,
   *  so it is shown in full for confirmation (it is not a secret — it is on the
   *  merchant's own QR). */
  private summariseAccounts(accounts: Partial<Record<Currency, BakongAccount>>) {
    return (Object.keys(accounts) as Currency[]).sort().map((currency) => {
      const c = accounts[currency]!;
      return {
        currency,
        bakong_account_id: c.bakongAccountId,
        account_information: c.accountInformation ?? null,
        merchant_name: c.merchantName ?? null,
        merchant_city: c.merchantCity ?? null,
        acquiring_bank: c.acquiringBank ?? null,
        account_type: c.isMerchant ? 'merchant' : 'individual',
      };
    });
  }
}

@ApiTags('khqr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard/stores/:storeId/khqr')
export class KhqrImportController {
  constructor(private readonly svc: KhqrImportService) {}

  @Get()
  @ApiOperation({ summary: 'The Bakong account imported for this store' })
  get(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.svc.get(user, storeId);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import the KHQR issued by the merchant’s own bank' })
  import(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: ImportKhqrDto) {
    return this.svc.import(user, storeId, dto);
  }

  @Get('counter')
  @ApiOperation({ summary: 'A static KHQR to display at a POS counter (payer types the amount)' })
  counter(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('currency') currency?: string) {
    const cur: Currency = currency === 'USD' ? 'USD' : 'KHR';
    return this.svc.preview(user, storeId, undefined, cur);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove an imported KHQR account (one currency, or all)' })
  remove(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('currency') currency?: string) {
    const cur = currency === 'USD' || currency === 'KHR' ? currency : undefined;
    return this.svc.remove(user, storeId, 'test', cur);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [KhqrImportController],
  providers: [KhqrImportService],
  exports: [KhqrImportService],
})
export class KhqrImportModule {}
