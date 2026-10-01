import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import type { Env } from '../config/env.schema'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { presignObject } from './s3-presign'

const MAX_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB (roadmap §4 media)
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
const UPLOAD_TTL = 900 // 15 min to complete the PUT
const READ_TTL = 300 // 5 min signed read (§ contract)

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
}

export interface StorageConfig {
  accessKey: string
  secretKey: string
  bucket: string
  endpoint: string
  region: string
}

/**
 * Media metadata + presigned object-store access. Bytes never pass through
 * the API — clients PUT directly to S3/MinIO with a short-lived URL. The
 * module fails closed: without S3_* configuration every media endpoint
 * answers 503 STORAGE_NOT_CONFIGURED instead of silently degrading.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Storage is optional at boot (Phase 9 infra), required at use time. */
  private storageConfig(): StorageConfig {
    const accessKey = this.config.get<string>('S3_ACCESS_KEY')
    const secretKey = this.config.get<string>('S3_SECRET_KEY')
    const bucket = this.config.get<string>('S3_BUCKET')
    const endpoint = this.config.get<string>('S3_ENDPOINT')
    if (!accessKey || !secretKey || !bucket || !endpoint) {
      throw new ApiError(
        'STORAGE_NOT_CONFIGURED',
        'Object storage is not configured on this server.',
        503,
      )
    }
    return {
      accessKey,
      secretKey,
      bucket,
      endpoint,
      region: this.config.get('S3_REGION', { infer: true }),
    }
  }

  async createUploadUrl(
    user: { id: string; garageId: string },
    input: { entityType: string; entityId: string; filename: string; mimeType: string; sizeBytes: number; tag?: string },
  ) {
    const cfg = this.storageConfig()

    if (!ALLOWED_MIME.has(input.mimeType)) {
      throw ApiError.validation('Only JPEG, PNG, WEBP images and MP4 video are allowed.')
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_SIZE_BYTES) {
      throw ApiError.validation('File must be between 1 byte and 25 MB.')
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(input.entityId)) {
      throw ApiError.validation('entityId must be a UUID.')
    }
    if (input.tag && (input.tag.length > 40 || !/^[A-Z0-9_]+$/i.test(input.tag))) {
      throw ApiError.validation('Invalid media tag.')
    }

    const ext = EXT_BY_MIME[input.mimeType]
    // Server-generated key: tenant/entity-scoped, unguessable, path-safe.
    const objectKey = `${user.garageId}/${input.entityId}/${randomUUID()}.${ext}`

    // Loose link for board/QR convenience: direct WO attribution when the
    // media belongs to a work order itself (photos tagged on the job card).
    const workOrderId = input.entityType === 'WORK_ORDER' ? input.entityId : null

    const media = await this.prisma.mediaFile.create({
      data: {
        garageId: user.garageId,
        workOrderId,
        tag: input.tag?.toUpperCase(),
        entityType: input.entityType.slice(0, 40),
        entityId: input.entityId,
        uploadedById: user.id,
        filename: input.filename.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        objectKey,
        status: 'PENDING',
      },
    })

    const presigned = presignObject(
      { ...cfg, expirySeconds: UPLOAD_TTL },
      'PUT',
      objectKey,
    )

    return {
      mediaFile: {
        id: media.id,
        objectKey: media.objectKey,
        status: media.status,
        filename: media.filename,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
      },
      uploadUrl: presigned.url,
      expiresIn: UPLOAD_TTL,
    }
  }

  /** Client confirms the PUT completed → metadata becomes READY. */
  async confirm(mediaId: string, user: { id: string; garageId: string }) {
    const media = await this.prisma.mediaFile.findFirst({
      where: { id: mediaId, garageId: user.garageId },
      select: { id: true, status: true },
    })
    if (!media) throw ApiError.notFound('NOT_FOUND', 'Media file was not found.')
    if (media.status === 'READY') return { id: media.id, status: 'READY' }

    const updated = await this.prisma.mediaFile.update({
      where: { id: media.id },
      data: { status: 'READY' },
      select: { id: true, status: true },
    })
    return updated
  }

  /** Short-lived signed read URL (staff-only in 5B; customer scope in 5C). */
  async readUrl(mediaId: string, user: { id: string; garageId: string }) {
    const cfg = this.storageConfig()
    const media = await this.prisma.mediaFile.findFirst({
      where: { id: mediaId, garageId: user.garageId, status: 'READY' },
      select: { id: true, objectKey: true },
    })
    if (!media) throw ApiError.notFound('NOT_FOUND', 'Media file was not found.')
    const presigned = presignObject({ ...cfg, expirySeconds: READ_TTL }, 'GET', media.objectKey)
    return { url: presigned.url, expiresIn: READ_TTL }
  }
}
