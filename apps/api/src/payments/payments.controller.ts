import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, ListPaymentsDto, SimulateDto } from './dto';
import { ApiKeyGuard, getApiKeyContext } from '../auth/api-key.guard';

/** Public developer API — authenticated with a `bk_live_` / `bk_test_` API key. */
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a KHQR payment' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  async create(
    @Req() req: Request,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = getApiKeyContext(req);
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(dto);
    const { resource, status } = await this.payments.create(ctx, dto, idempotencyKey, rawBody);
    res.status(status);
    return resource;
  }

  @Get()
  @ApiOperation({ summary: 'List payments' })
  list(@Req() req: Request, @Query() query: ListPaymentsDto) {
    return this.payments.list(getApiKeyContext(req), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a payment' })
  retrieve(@Req() req: Request, @Param('id') id: string) {
    return this.payments.retrieve(getApiKeyContext(req), id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a payment (before completion)' })
  cancel(@Req() req: Request, @Param('id') id: string) {
    return this.payments.cancel(getApiKeyContext(req), id);
  }

  @Post(':id/simulate')
  @ApiOperation({
    summary: 'Simulate a status change (test-mode keys only)',
    description:
      'Drives the mock provider through pending → scanned → paid/failed/expired so you can run an end-to-end test payment.',
  })
  simulate(@Req() req: Request, @Param('id') id: string, @Body() dto: SimulateDto) {
    return this.payments.simulate(getApiKeyContext(req), id, dto.status);
  }
}
