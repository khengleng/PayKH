import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentStatus } from '@paykh/shared-types';

export class CreatePaymentDto {
  @IsString()
  amount!: string;

  @IsIn(['USD', 'KHR'])
  currency!: 'USD' | 'KHR';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(86_400)
  expires_in_seconds?: number;
}

export class ListPaymentsDto {
  @IsOptional()
  @IsIn(['pending', 'scanned', 'paid', 'expired', 'failed', 'cancelled', 'refunded'])
  status?: PaymentStatus;

  @IsOptional()
  @IsString()
  reference_id?: string;

  @IsOptional()
  @IsString()
  created_from?: string;

  @IsOptional()
  @IsString()
  created_to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class SimulateDto {
  @IsIn(['scanned', 'paid', 'failed', 'expired'])
  status!: 'scanned' | 'paid' | 'failed' | 'expired';
}

export class RefundDto {
  @IsOptional()
  @IsString()
  amount?: string; // omit for a full refund of the remaining amount

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
