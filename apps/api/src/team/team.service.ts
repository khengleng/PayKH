import { Injectable } from '@nestjs/common';
import { MemberRole as DbRole } from '@prisma/client';
import { randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

const toDbRole = (r: string): DbRole => r.toUpperCase() as DbRole;

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

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

  async invite(user: AuthUser, organizationId: string, email: string, role: string) {
    requirePermission(user, organizationId, 'team:manage');
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
