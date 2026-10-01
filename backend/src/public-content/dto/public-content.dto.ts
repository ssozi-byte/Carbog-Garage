import { ApiProperty } from '@nestjs/swagger'

export class GarageHourDto {
  @ApiProperty() dayOfWeek: number
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) opensAt: Date | null
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) closesAt: Date | null
  @ApiProperty() isClosed: boolean
}

export class GaragePublicDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() slug: string
  @ApiProperty() phone: string
  @ApiProperty({ nullable: true }) whatsappNumber: string | null
  @ApiProperty() email: string
  @ApiProperty() address: string
  @ApiProperty({ nullable: true }) area: string | null
  @ApiProperty() city: string
  @ApiProperty() county: string
  @ApiProperty() country: string
  @ApiProperty({ type: [GarageHourDto] }) hours: GarageHourDto[]
  @ApiProperty({ type: [String] }) brandsServiced: string[]
  @ApiProperty({ nullable: true }) stats: unknown
  @ApiProperty({ nullable: true }) socials: unknown
  @ApiProperty() directionsUrl: string
}

export class ServicePublicDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() slug: string
  @ApiProperty({ nullable: true }) description: string | null
  @ApiProperty({ nullable: true }) iconKey: string | null
  @ApiProperty({ nullable: true }) displayNum: string | null
  @ApiProperty({ type: [String] }) points: string[]
  @ApiProperty({ enum: ['CORE', 'EXTRA', 'BOOKING_ONLY', 'WASH'] })
  category: 'CORE' | 'EXTRA' | 'BOOKING_ONLY' | 'WASH'
  @ApiProperty({ nullable: true }) estimatedDurationMinutes: number | null
  @ApiProperty({ nullable: true }) basePrice: number | null
  @ApiProperty() currency: string
}

export class TestimonialPublicDto {
  @ApiProperty() id: string
  @ApiProperty() authorName: string
  @ApiProperty({ nullable: true }) authorArea: string | null
  @ApiProperty({ nullable: true }) vehicle: string | null
  @ApiProperty() rating: number
  @ApiProperty() quote: string
  @ApiProperty() isFeatured: boolean
}

export class GalleryItemPublicDto {
  @ApiProperty() id: string
  @ApiProperty() title: string
  @ApiProperty({ nullable: true }) vehicleLabel: string | null
  @ApiProperty({ enum: ['ENGINE', 'BRAKES', 'SUSPENSION', 'DIAGNOSTICS', 'AC_COOLING', 'ELECTRICAL', 'OTHER'] })
  tag: string
  @ApiProperty({ nullable: true }) imageUrl: string | null
  @ApiProperty({ nullable: true }) videoUrl: string | null
}
