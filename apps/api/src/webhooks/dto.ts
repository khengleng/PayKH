import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

const EVENT_TYPES = [
  'payment.created',
  'payment.scanned',
  'payment.completed',
  'payment.expired',
  'payment.failed',
  'payment.cancelled',
];

export class CreateWebhookDto {
  @IsString()
  storeId!: string;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsIn(EVENT_TYPES, { each: true })
  enabledEvents?: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsIn(EVENT_TYPES, { each: true })
  enabledEvents?: string[];

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
