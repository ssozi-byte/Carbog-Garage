import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { PublicContentService } from './public-content.service'
import {
  GaragePublicDto,
  ServicePublicDto,
  TestimonialPublicDto,
  GalleryItemPublicDto,
} from './dto/public-content.dto'
import { clampPagination } from '../common/utils/pagination'

function parsePageLimit(qs: Record<string, unknown>) {
  const page = Number.parseInt(String(qs.page ?? '1'), 10)
  const limit = Number.parseInt(String(qs.limit ?? '20'), 10)
  return clampPagination(Number.isNaN(page) ? 1 : page, Number.isNaN(limit) ? 20 : limit)
}

@ApiTags('public-content')
@Controller()
export class PublicContentController {
  constructor(private readonly content: PublicContentService) {}

  @Get('garages/public/current')
  @ApiOkResponse({ type: GaragePublicDto })
  async getGarage() {
    return this.content.getPublicGarage()
  }

  @Get('services')
  @ApiOkResponse({ type: [ServicePublicDto] })
  async listServices(@Query() qs: Record<string, unknown>) {
    const { page, limit } = parsePageLimit(qs)
    const category = qs.category === 'CORE' || qs.category === 'EXTRA' ? qs.category : undefined
    const { items, meta } = await this.content.listServices(page, limit, category)
    return { items, meta }
  }

  @Get('testimonials')
  @ApiOkResponse({ type: [TestimonialPublicDto] })
  async listTestimonials(@Query() qs: Record<string, unknown>) {
    const { page, limit } = parsePageLimit(qs)
    const featured = qs.featured === 'true' ? true : qs.featured === 'false' ? false : undefined
    const { items, meta } = await this.content.listTestimonials(page, limit, featured)
    return { items, meta }
  }

  @Get('gallery-items')
  @ApiOkResponse({ type: [GalleryItemPublicDto] })
  async listGalleryItems(@Query() qs: Record<string, unknown>) {
    const { page, limit } = parsePageLimit(qs)
    const tag = typeof qs.tag === 'string' && qs.tag !== 'OTHER' ? (qs.tag as string) : qs.tag === 'OTHER' ? 'OTHER' : undefined
    const { items, meta } = await this.content.listGalleryItems(page, limit, tag)
    return { items, meta }
  }
}
