import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitVerificationDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @IsString()
  @MaxLength(80)
  businessType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  registrationNumber?: string;

  @IsString()
  @MaxLength(120)
  contactName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  /** References to uploaded documents: [{ type, name, url }]. */
  @IsOptional()
  @IsArray()
  documents?: { type: string; name?: string; url?: string }[];
}

export class RejectVerificationDto {
  @IsString()
  @MaxLength(300)
  reason!: string;
}
