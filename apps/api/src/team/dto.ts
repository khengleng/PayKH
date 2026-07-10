import { IsEmail, IsIn, IsString } from 'class-validator';

const ASSIGNABLE_ROLES = ['owner', 'developer', 'analyst'];

export class InviteDto {
  @IsString()
  organizationId!: string;

  @IsEmail()
  email!: string;

  @IsIn(ASSIGNABLE_ROLES)
  role!: 'owner' | 'developer' | 'analyst';
}

export class ChangeRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: 'owner' | 'developer' | 'analyst';
}

export class AcceptInviteDto {
  @IsString()
  token!: string;
}
