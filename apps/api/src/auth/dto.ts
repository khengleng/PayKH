import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
// (MfaCodeDto below shares these validators)

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  password!: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  organizationName?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsString()
  @IsOptional()
  mfaCode?: string;
}

export class MfaCodeDto {
  @IsString()
  code!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class VerifyEmailDto {
  @IsString()
  token!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
