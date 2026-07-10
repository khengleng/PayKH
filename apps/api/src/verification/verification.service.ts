import { Injectable, Logger } from '@nestjs/common';
import { MerchantVerification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { EmailService } from '../email/email.service';
import { verificationEmail } from '../email/templates';
import { SubmitVerificationDto } from './dto';

/**
 * Merchant KYC verification. A merchant submits business details/documents; a
 * platform admin approves or rejects. Live-mode activation is gated on an
 * approved (VERIFIED) verification.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger('Verification');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** True when the organization has an approved verification. */
  async isVerified(organizationId: string): Promise<boolean> {
    const v = await this.prisma.merchantVerification.findUnique({ where: { organizationId } });
    return v?.status === 'VERIFIED';
  }

  async assertVerified(organizationId: string): Promise<void> {
    if (!(await this.isVerified(organizationId))) {
      throw ApiError.forbidden('Merchant verification (KYC) is required to activate live mode');
    }
  }

  async submit(user: AuthUser, dto: SubmitVerificationDto) {
    requirePermission(user, dto.organizationId, 'billing:manage');
    const existing = await this.prisma.merchantVerification.findUnique({
      where: { organizationId: dto.organizationId },
    });
    if (existing?.status === 'VERIFIED') {
      throw ApiError.invalidRequest('Organization is already verified');
    }
    const data = {
      status: 'PENDING' as const,
      legalName: dto.legalName,
      businessType: dto.businessType,
      registrationNumber: dto.registrationNumber ?? null,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone ?? null,
      address: dto.address ?? null,
      documents: (dto.documents ?? []) as unknown as Prisma.InputJsonValue,
      rejectionReason: null,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedByUserId: null,
    };
    const verification = await this.prisma.merchantVerification.upsert({
      where: { organizationId: dto.organizationId },
      create: { organizationId: dto.organizationId, ...data },
      update: data,
    });
    this.logger.log(`verification submitted for org ${dto.organizationId}`);
    return this.serialize(verification);
  }

  async get(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'store:read');
    const v = await this.prisma.merchantVerification.findUnique({ where: { organizationId } });
    if (!v) return { organization_id: organizationId, status: 'unverified' };
    return this.serialize(v);
  }

  // --------------------------------------------------------------- admin ops
  async listForReview() {
    const rows = await this.prisma.merchantVerification.findMany({
      where: { status: 'PENDING' },
      include: { organization: true },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });
    return rows.map((v) => ({ ...this.serialize(v), organization_name: v.organization.name }));
  }

  async review(organizationId: string, approve: boolean, reviewerUserId: string, reason?: string) {
    const v = await this.prisma.merchantVerification.findUnique({ where: { organizationId } });
    if (!v) throw ApiError.paymentNotFound('No verification submitted for this organization');
    const updated = await this.prisma.merchantVerification.update({
      where: { organizationId },
      data: {
        status: approve ? 'VERIFIED' : 'REJECTED',
        rejectionReason: approve ? null : (reason ?? 'Not specified'),
        reviewedAt: new Date(),
        reviewedByUserId: reviewerUserId,
      },
    });

    // Notify org owners (best-effort).
    const owners = await this.prisma.organizationMember.findMany({
      where: { organizationId, role: 'OWNER' },
      include: { user: true },
    });
    for (const owner of owners) {
      await this.email.send(verificationEmail(owner.user.email, approve, reason));
    }
    this.logger.log(`verification for org ${organizationId} -> ${updated.status}`);
    return this.serialize(updated);
  }

  private serialize(v: MerchantVerification) {
    return {
      organization_id: v.organizationId,
      status: v.status.toLowerCase(),
      legal_name: v.legalName,
      business_type: v.businessType,
      registration_number: v.registrationNumber,
      contact_name: v.contactName,
      contact_phone: v.contactPhone,
      address: v.address,
      documents: v.documents,
      rejection_reason: v.rejectionReason,
      submitted_at: v.submittedAt.toISOString(),
      reviewed_at: v.reviewedAt?.toISOString() ?? null,
    };
  }
}
