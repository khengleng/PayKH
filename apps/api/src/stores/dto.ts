import {
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateStoreDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  successUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  failureUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  customMessage?: string;
}

export class UpsertCredentialDto {
  @IsIn(['test', 'live'])
  mode!: 'test' | 'live';

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  secret!: string; // stored encrypted at rest

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class ActivateLiveDto {
  @IsBoolean()
  liveMode!: boolean;
}
