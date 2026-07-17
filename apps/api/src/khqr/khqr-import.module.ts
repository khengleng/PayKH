import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Post, UseGuards } from '@nestjs/common';
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

export class ImportKhqrDto {
  /** The raw KHQR payload, e.g. decoded from the QR the merchant's bank issued. */
  @IsString() @MinLength(12) @MaxLength(1024) qr_string!: string;
  @IsOptional() @IsIn(['test', 'live']) mode?: 'test' | 'live';
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

    const credential = {
      bakongAccountId: parsed.bakongAccountId,
      // The payee's account/phone from tag 29 sub-tag 01. Banks surface this as
      // the "receiver account" and at least one refuses a QR without it, so it
      // must survive the round trip.
      accountInformation: parsed.accountInformation,
      // The currency the bank's own QR declared (tag 53). Dropping it let us
      // issue a USD QR against a KHR-only account, which a bank may refuse.
      currency: parsed.currency,
      merchantName: parsed.merchantName,
      merchantCity: parsed.merchantCity ?? 'Phnom Penh',
      merchantId: parsed.merchantId,
      acquiringBank: parsed.acquiringBank,
      isMerchant: parsed.isMerchant,
    };

    // Prove we can reissue against this account BEFORE saving it. A credential
    // that stores cleanly but cannot produce a scannable QR would surface as a
    // failed checkout in front of a customer.
    //
    // No amount: the sample is STATIC, exactly like the QR the bank issued, so
    // the payer types the figure. Fixing an amount here would only test a number
    // PayKH invented, and it made the sample useless for a merchant who wants to
    // send someone a real request.
    const probe = buildBakongKhqr({
      bakongAccountId: credential.bakongAccountId,
      accountInformation: credential.accountInformation,
      merchantName: credential.merchantName ?? 'Merchant',
      merchantCity: credential.merchantCity,
      currency: credential.currency ?? 'USD',
      merchantId: credential.merchantId,
      acquiringBank: credential.acquiringBank,
      isMerchant: credential.isMerchant,
    });
    const reissued = parseKhqr(probe.qrString); // throws if we built something invalid
    if (reissued.bakongAccountId !== credential.bakongAccountId) {
      throw ApiError.internal('Reissued QR does not name the imported account');
    }

    const ciphertext = this.crypto.encrypt(JSON.stringify(credential));
    await this.prisma.providerCredential.upsert({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
      create: {
        storeId,
        provider: 'bakong',
        mode: mode === 'live' ? 'LIVE' : 'TEST',
        label: `KHQR import — ${credential.bakongAccountId}`,
        secretCiphertext: ciphertext,
      },
      update: { label: `KHQR import — ${credential.bakongAccountId}`, secretCiphertext: ciphertext },
    });
    this.logger.log(`khqr imported for ${storeId} (${mode}): ${credential.bakongAccountId}`);

    return {
      imported: true,
      mode,
      ...this.summarise(credential, parsed.isStatic),
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
  async preview(user: AuthUser, storeId: string, amount: string | undefined, currency: 'USD' | 'KHR', mode: 'test' | 'live' = 'test') {
    await this.assertStore(user, storeId, 'store:read');
    const row = await this.prisma.providerCredential.findUnique({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
    });
    if (!row) throw ApiError.invalidRequest('No KHQR imported for this store yet');

    let cred: { bakongAccountId: string; accountInformation?: string; currency?: 'USD' | 'KHR'; merchantName?: string; merchantCity?: string; merchantId?: string; acquiringBank?: string; isMerchant?: boolean };
    try {
      cred = JSON.parse(this.crypto.decrypt(row.secretCiphertext));
    } catch {
      throw ApiError.invalidRequest('Stored credential could not be decrypted; re-import the KHQR.');
    }

    if (amount !== undefined) {
      // A malformed amount would produce a QR a bank silently refuses, which is
      // far worse to debug than a rejection here.
      if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw ApiError.invalidRequest('Amount must be a number like "12.50"');
      if (Number(amount) <= 0) throw ApiError.invalidRequest('Amount must be greater than zero');
    }

    const { qrString, md5 } = buildBakongKhqr({
      bakongAccountId: cred.bakongAccountId,
      accountInformation: cred.accountInformation,
      merchantName: cred.merchantName ?? 'Merchant',
      merchantCity: cred.merchantCity ?? 'Phnom Penh',
      amount,
      currency,
      merchantId: cred.merchantId,
      acquiringBank: cred.acquiringBank,
      isMerchant: cred.isMerchant,
    });
    return { qr_string: qrString, md5, amount: amount ?? null, currency, bakong_account_id: cred.bakongAccountId };
  }

  async get(user: AuthUser, storeId: string, mode: 'test' | 'live' = 'test') {
    await this.assertStore(user, storeId, 'store:read');
    const row = await this.prisma.providerCredential.findUnique({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' } },
    });
    if (!row) return { imported: false, mode };
    try {
      const cred = JSON.parse(this.crypto.decrypt(row.secretCiphertext));
      return { imported: true, mode, ...this.summarise(cred), updated_at: row.updatedAt };
    } catch {
      // ENCRYPTION_KEY rotation. Say so rather than 500 — re-importing fixes it.
      return { imported: true, mode, unreadable: true, detail: 'Stored credential could not be decrypted; re-import the KHQR.' };
    }
  }

  async remove(user: AuthUser, storeId: string, mode: 'test' | 'live' = 'test') {
    await this.assertStore(user, storeId, 'store:write');
    await this.prisma.providerCredential.deleteMany({
      where: { storeId, provider: 'bakong', mode: mode === 'live' ? 'LIVE' : 'TEST' },
    });
    return { imported: false, mode };
  }

  /** What we show back. The account id is not a secret — it is printed on the
   *  merchant's own QR — but it identifies where money lands, so it is worth
   *  showing in full for confirmation. */
  private summarise(c: { bakongAccountId: string; accountInformation?: string; currency?: 'USD' | 'KHR'; merchantName?: string; merchantCity?: string; acquiringBank?: string; isMerchant?: boolean }, isStatic?: boolean) {
    return {
      bakong_account_id: c.bakongAccountId,
      account_information: c.accountInformation ?? null,
      // Null when the bank's QR named no currency — then the payer's app decides.
      currency: c.currency ?? null,
      merchant_name: c.merchantName ?? null,
      merchant_city: c.merchantCity ?? null,
      acquiring_bank: c.acquiringBank ?? null,
      account_type: c.isMerchant ? 'merchant' : 'individual',
      ...(isStatic === undefined ? {} : { source_was_static: isStatic }),
    };
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

  @Delete()
  @ApiOperation({ summary: 'Remove the imported KHQR account' })
  remove(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.svc.remove(user, storeId);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [KhqrImportController],
  providers: [KhqrImportService],
  exports: [KhqrImportService],
})
export class KhqrImportModule {}
