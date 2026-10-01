import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { MediaService } from './media.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { UploadUrlDto, uploadUrlSchema, type UploadUrlInput } from './dto/media.dto'

/**
 * Media (Phase 5B). The API never streams file bytes: clients PUT directly
 * to object storage with a short-lived presigned URL, then confirm. Without
 * S3_* configuration every route fails closed with 503 STORAGE_NOT_CONFIGURED.
 */
@ApiTags('media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Issues a presigned PUT + creates the PENDING metadata row. */
  @Post('upload-url')
  @Roles('MECHANIC+')
  @ApiBody({ type: UploadUrlDto })
  uploadUrl(@Body(new ZodValidationPipe(uploadUrlSchema)) body: UploadUrlInput, @Req() req: Request) {
    const user = (req as Request & { user?: { id: string; garageId: string } }).user!
    return this.media.createUploadUrl(user, body)
  }

  /** Confirms the PUT succeeded → metadata READY (attachable to results). */
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles('MECHANIC+')
  confirm(@Param('id') id: string, @Req() req: Request) {
    const user = (req as Request & { user?: { id: string; garageId: string } }).user!
    return this.media.confirm(id, user)
  }

  /** Short-lived signed read URL. */
  @Get(':id/url')
  @HttpCode(HttpStatus.OK)
  @Roles('MECHANIC+')
  readUrl(@Param('id') id: string, @Req() req: Request) {
    const user = (req as Request & { user?: { id: string; garageId: string } }).user!
    return this.media.readUrl(id, user)
  }
}
