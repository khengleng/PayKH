import { Injectable } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Branch, Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class CreateBranchDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  private async storeOrgId(storeId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    return store.organizationId;
  }

  async create(user: AuthUser, storeId: string, dto: CreateBranchDto) {
    requirePermission(user, await this.storeOrgId(storeId), 'store:write');
    try {
      const branch = await this.prisma.branch.create({
        data: {
          id: prefixedId('br'),
          storeId,
          name: dto.name,
          code: dto.code ?? null,
          address: dto.address ?? null,
        },
      });
      return this.serialize(branch);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ApiError.invalidRequest('A branch with this code already exists in the store');
      }
      throw err;
    }
  }

  async list(user: AuthUser, storeId: string) {
    requirePermission(user, await this.storeOrgId(storeId), 'store:read');
    const branches = await this.prisma.branch.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });
    return branches.map((b) => this.serialize(b));
  }

  async update(user: AuthUser, branchId: string, dto: UpdateBranchDto) {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw ApiError.paymentNotFound('Branch not found');
    requirePermission(user, await this.storeOrgId(branch.storeId), 'store:write');
    try {
      const updated = await this.prisma.branch.update({
        where: { id: branchId },
        data: { name: dto.name, code: dto.code, address: dto.address, isActive: dto.isActive },
      });
      return this.serialize(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ApiError.invalidRequest('A branch with this code already exists in the store');
      }
      throw err;
    }
  }

  async remove(user: AuthUser, branchId: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw ApiError.paymentNotFound('Branch not found');
    requirePermission(user, await this.storeOrgId(branch.storeId), 'store:write');
    // Soft-delete by deactivating if it has payments; hard-delete otherwise.
    const paymentCount = await this.prisma.payment.count({ where: { branchId } });
    if (paymentCount > 0) {
      await this.prisma.branch.update({ where: { id: branchId }, data: { isActive: false } });
      return { id: branchId, deactivated: true };
    }
    await this.prisma.branch.delete({ where: { id: branchId } });
    return { id: branchId, deleted: true };
  }

  /** Resolve + validate a branch belongs to the store and is active (for /v1). */
  async resolveActive(storeId: string, branchId: string): Promise<string> {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.storeId !== storeId) {
      throw ApiError.invalidRequest('Unknown branch_id for this store');
    }
    if (!branch.isActive) throw ApiError.invalidRequest('Branch is inactive');
    return branch.id;
  }

  private serialize(b: Branch) {
    return {
      id: b.id,
      store_id: b.storeId,
      name: b.name,
      code: b.code,
      address: b.address,
      is_active: b.isActive,
      created_at: b.createdAt.toISOString(),
    };
  }
}
