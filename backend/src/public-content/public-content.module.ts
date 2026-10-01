import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { PublicContentController } from './public-content.controller'
import { PublicContentService } from './public-content.service'
import { PublicRateLimitMiddleware } from '../common/middleware/rate-limit.factory'

@Module({
  controllers: [PublicContentController],
  providers: [PublicContentService],
})
export class PublicContentModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Path-only (all methods) — these are read-only endpoints anyway.
    consumer
      .apply(PublicRateLimitMiddleware)
      .forRoutes('garages/public/current', 'services', 'testimonials', 'gallery-items')
  }
}
