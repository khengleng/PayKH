import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberRole as DbRole } from '@prisma/client';
import { randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission, roleForOrg } from '../auth/rbac';
import { EmailService } from '../email/email.service';
import { inviteEmail } from '../email/templates';

const toDbRole = (r: string): DbRole => r.toUpperCase() as DbRole;

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async listMembers(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'team:manage');
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      user_id: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role.toLowerCase(),
      joined_at: m.createdAt.toISOString(),
    }));
  }

  /**
   * Only an owner may grant the owner role. `team:manage` alone (held by
   * platform_admin, which is NOT itself an org owner) must not be able to mint
   * owners — otherwise a platform_admin member could self-escalate to owner and
   * pick up money-moving permissions (mint live keys, write payments) it lacks.
   */
  private assertCanAssignRole(user: AuthUser, organizationId: string, role: string) {
    if (toDbRole(role) === 'OWNER' && roleForOrg(user, organizationId) !== 'owner') {
      throw ApiError.forbidden('Only an organization owner can grant the owner role');
    }
  }

  async invite(user: AuthUser, organizationId: string, email: string, role: string) {
    requirePermission(user, organizationId, 'team:manage');
    this.assertCanAssignRole(user, organizationId, role);
    const normalized = email.toLowerCase().trim();

    // Already a member?
    const existingUser = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existingUser) {
      const membership = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: existingUser.id } },
      });
      if (membership) throw ApiError.invalidRequest('User is already a member');
    }

    const token = `inv_${randomBase58(32)}`;
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId,
        email: normalized,
        role: toDbRole(role),
        token,
        invitedByUserId: user.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Best-effort invite email.
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const dashboardUrl = this.config.get<string>('dashboardBaseUrl');
    const acceptUrl = `${dashboardUrl}/invite?token=${token}`;
    await this.email.send(inviteEmail(normalized, org?.name ?? 'an organization', role, acceptUrl));

    return {
      id: invitation.id,
      email: normalized,
      role,
      token, // the invite acceptance token (delivered by email in a later phase)
      expires_at: invitation.expiresAt.toISOString(),
    };
  }

  async listInvitations(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'team:manage');
    const invites = await this.prisma.invitation.findMany({
      where: { organizationId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role.toLowerCase(),
      status: i.status,
      created_at: i.createdAt.toISOString(),
      expires_at: i.expiresAt.toISOString(),
    }));
  }

  async revokeInvitation(user: AuthUser, invitationId: string) {
    const invite = await this.prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invite) throw ApiError.paymentNotFound('Invitation not found');
    requirePermission(user, invite.organizationId, 'team:manage');
    await this.prisma.invitation.update({ where: { id: invitationId }, data: { status: 'revoked' } });
    return { id: invitationId, revoked: true };
  }

  /** Accept an invitation as the currently-authenticated user. */
  async accept(user: AuthUser, token: string) {
    const invite = await this.prisma.invitation.findUnique({ where: { token } });
    if (!invite || invite.status !== 'pending') throw ApiError.invalidRequest('Invalid invitation');
    if (invite.expiresAt < new Date()) throw ApiError.invalidRequest('Invitation expired');

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!dbUser || dbUser.email.toLowerCase() !== invite.email) {
      throw ApiError.forbidden('This invitation was issued to a different email');
    }

    await this.prisma.$transaction([
      this.prisma.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.userId } },
        create: { organizationId: invite.organizationId, userId: user.userId, role: invite.role },
        update: { role: invite.role },
      }),
      this.prisma.invitation.update({ where: { id: invite.id }, data: { status: 'accepted' } }),
    ]);
    return { organization_id: invite.organizationId, role: invite.role.toLowerCase(), accepted: true };
  }

  async changeRole(user: AuthUser, organizationId: string, targetUserId: string, role: string) {
    requirePermission(user, organizationId, 'team:manage');
    this.assertCanAssignRole(user, organizationId, role);
    const target = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    if (!target) throw ApiError.paymentNotFound('Member not found');

    // Don't allow demoting the last owner.
    if (target.role === 'OWNER' && toDbRole(role) !== 'OWNER') {
      await this.assertNotLastOwner(organizationId, targetUserId);
    }
    const updated = await this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      data: { role: toDbRole(role) },
    });
    return { user_id: targetUserId, role: updated.role.toLowerCase() };
  }

  async removeMember(user: AuthUser, organizationId: string, targetUserId: string) {
    requirePermission(user, organizationId, 'team:manage');
    const target = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    if (!target) throw ApiError.paymentNotFound('Member not found');
    if (target.role === 'OWNER') await this.assertNotLastOwner(organizationId, targetUserId);
    await this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    return { user_id: targetUserId, removed: true };
  }

  private async assertNotLastOwner(organizationId: string, excludingUserId: string) {
    const owners = await this.prisma.organizationMember.count({
      where: { organizationId, role: 'OWNER', userId: { not: excludingUserId } },
    });
    if (owners === 0) throw ApiError.invalidRequest('Cannot remove or demote the last owner');
  }
}
