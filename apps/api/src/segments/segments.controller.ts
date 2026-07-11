import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { SegmentsService, CreateSegmentDto, UpdateSegmentDto } from './segments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { SegmentRules } from './segment-rules';

class PreviewRulesDto {
  @IsObject() rules!: SegmentRules;
}

@ApiTags('segments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get('stores/:storeId/segments')
  @ApiOperation({ summary: 'List customer segments' })
  list(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string) {
    return this.segments.list(user, storeId);
  }

  @Post('stores/:storeId/segments')
  @ApiOperation({ summary: 'Create a segment' })
  create(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: CreateSegmentDto) {
    return this.segments.create(user, storeId, dto);
  }

  @Post('stores/:storeId/segments/preview')
  @ApiOperation({ summary: 'Preview a segment size for arbitrary rules' })
  previewRules(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Body() dto: PreviewRulesDto) {
    return this.segments.previewRules(user, storeId, dto.rules);
  }

  @Get('segments/:id/preview')
  @ApiOperation({ summary: 'Preview a saved segment (count + sample)' })
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.segments.preview(user, id);
  }

  @Patch('segments/:id')
  @ApiOperation({ summary: 'Update a segment' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSegmentDto) {
    return this.segments.update(user, id, dto);
  }

  @Delete('segments/:id')
  @ApiOperation({ summary: 'Delete a segment' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.segments.remove(user, id);
  }
}
