import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import { clampPagination, type PageMeta } from '../common/utils/pagination'
import {
  GaragePublicDto,
  ServicePublicDto,
  TestimonialPublicDto,
  GalleryItemPublicDto,
} from './dto/public-content.dto'

const CACHE_TTL_MS = 60_000

@Injectable()
export class PublicContentService {
  private cache = new TtlCache<unknown>(CACHE_TTL_MS)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single-tenant resolution for the public site (M4): the seeded garage.
   * Multi-garage deployment resolves this from the hostname instead.
   */
  private async currentGarage() {
    return this.cache.wrap('garage:current', async () => {
      const garage = await this.prisma.garage.findFirst({
        where: { status: 'ACTIVE' },
        include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
      })
      if (!garage) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
      return garage
    })
  }

  async getPublicGarage(): Promise<GaragePublicDto> {
    const g = await this.currentGarage()
    const query = g.latitude && g.longitude
      ? `${g.latitude},${g.longitude}`
      : encodeURIComponent(`${g.address}, ${g.city}, Kenya`)
    return {
      id: g.id,
      name: g.name,
      slug: g.slug,
      phone: g.phone,
      whatsappNumber: g.whatsappNumber,
      email: g.email,
      address: g.address,
      area: g.area,
      city: g.city,
      county: g.county,
      country: g.country,
      hours: g.hours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        opensAt: h.opensAt,
        closesAt: h.closesAt,
        isClosed: h.isClosed,
      })),
      brandsServiced: g.brandsServiced,
      stats: g.stats,
      socials: g.socials,
      directionsUrl: `https://www.google.com/maps/search/?api=1&query=${query}`,
    }
  }

  async listServices(
    page = 1,
    limit = 20,
    category?: 'CORE' | 'EXTRA',
  ): Promise<{ items: ServicePublicDto[]; meta: PageMeta }> {
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    return this.cache.wrap(`services:${category ?? 'all'}:p${p}:l${l}`, async () => {
      const where = { isActive: true, ...(category ? { category } : {}) }
      const [total, rows] = await Promise.all([
        this.prisma.service.count({ where }),
        this.prisma.service.findMany({
          where,
          orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
          skip,
          take,
        }),
      ])
      return {
        items: rows.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          description: s.description,
          iconKey: s.iconKey,
          displayNum: s.displayNum,
          points: s.points,
          category: s.category,
          estimatedDurationMinutes: s.estimatedDurationMinutes,
          basePrice: s.basePrice,
          currency: s.currency,
        })),
        meta: { page: p, limit: l, total },
      }
    })
  }

  async listTestimonials(
    page = 1,
    limit = 20,
    featured?: boolean,
  ): Promise<{ items: TestimonialPublicDto[]; meta: PageMeta }> {
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    return this.cache.wrap(`testimonials:${featured ? 'featured' : 'all'}:p${p}:l${l}`, async () => {
      const where = { isApproved: true, ...(featured !== undefined ? { isFeatured: featured } : {}) }
      const [total, rows] = await Promise.all([
        this.prisma.testimonial.count({ where }),
        this.prisma.testimonial.findMany({
          where,
          orderBy: [{ displayOrder: 'asc' }],
          skip,
          take,
        }),
      ])
      return {
        items: rows.map((t) => ({
          id: t.id,
          authorName: t.authorName,
          authorArea: t.authorArea,
          vehicle: t.vehicle,
          rating: t.rating,
          quote: t.quote,
          isFeatured: t.isFeatured,
        })),
        meta: { page: p, limit: l, total },
      }
    })
  }

  async listGalleryItems(
    page = 1,
    limit = 20,
    tag?: string,
  ): Promise<{ items: GalleryItemPublicDto[]; meta: PageMeta }> {
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    return this.cache.wrap(`gallery:${tag ?? 'all'}:p${p}:l${l}`, async () => {
      const where = { isPublished: true, ...(tag ? { tag: tag as never } : {}) }
      const [total, rows] = await Promise.all([
        this.prisma.galleryItem.count({ where }),
        this.prisma.galleryItem.findMany({
          where,
          orderBy: [{ displayOrder: 'asc' }],
          skip,
          take,
        }),
      ])
      return {
        items: rows.map((w) => ({
          id: w.id,
          title: w.title,
          vehicleLabel: w.vehicleLabel,
          tag: w.tag,
          imageUrl: w.externalUrl,
          videoUrl: w.videoUrl,
        })),
        meta: { page: p, limit: l, total },
      }
    })
  }
}
