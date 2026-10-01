-- CreateEnum
CREATE TYPE "GarageStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'MECHANIC', 'SERVICE_ADVISOR', 'INVENTORY_MANAGER', 'CASHIER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "Transmission" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('CORE', 'EXTRA');

-- CreateEnum
CREATE TYPE "GalleryTag" AS ENUM ('ENGINE', 'BRAKES', 'SUSPENSION', 'DIAGNOSTICS', 'AC_COOLING', 'ELECTRICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "TestimonialSource" AS ENUM ('GOOGLE', 'WALKIN', 'FORM', 'MANUAL');

-- CreateTable
CREATE TABLE "garages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp_number" TEXT,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Kenya',
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "brands_serviced" TEXT[],
    "stats" JSONB,
    "socials" JSONB,
    "status" "GarageStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "garages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_hours" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "opens_at" TIME,
    "closes_at" TIME,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "garage_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "password_hash" TEXT NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMP(3),
    "phone_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "mfa_enforced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "registration_number" VARCHAR(12) NOT NULL,
    "make" VARCHAR(40) NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "year" INTEGER,
    "vin" VARCHAR(17),
    "engine_number" TEXT,
    "fuel_type" "FuelType",
    "transmission" "Transmission",
    "mileage" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "icon_key" TEXT,
    "display_num" VARCHAR(4),
    "points" TEXT[],
    "category" "ServiceCategory" NOT NULL DEFAULT 'CORE',
    "estimated_duration_minutes" INTEGER,
    "base_price" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "author_name" VARCHAR(120) NOT NULL,
    "author_area" VARCHAR(120),
    "vehicle" VARCHAR(120),
    "rating" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "source" "TestimonialSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_items" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "vehicle_label" VARCHAR(120),
    "tag" "GalleryTag" NOT NULL DEFAULT 'OTHER',
    "external_url" TEXT,
    "video_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "garages_slug_key" ON "garages"("slug");

-- CreateIndex
CREATE INDEX "garages_status_idx" ON "garages"("status");

-- CreateIndex
CREATE INDEX "garage_hours_garage_id_idx" ON "garage_hours"("garage_id");

-- CreateIndex
CREATE UNIQUE INDEX "garage_hours_garage_id_day_of_week_key" ON "garage_hours"("garage_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_garage_id_role_idx" ON "users"("garage_id", "role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "customer_profiles_garage_id_idx" ON "customer_profiles"("garage_id");

-- CreateIndex
CREATE INDEX "vehicles_registration_number_idx" ON "vehicles"("registration_number");

-- CreateIndex
CREATE INDEX "vehicles_customer_id_idx" ON "vehicles"("customer_id");

-- CreateIndex
CREATE INDEX "vehicles_garage_id_idx" ON "vehicles"("garage_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_garage_id_registration_number_customer_id_key" ON "vehicles"("garage_id", "registration_number", "customer_id");

-- CreateIndex
CREATE INDEX "services_garage_id_is_active_idx" ON "services"("garage_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "services_garage_id_slug_key" ON "services"("garage_id", "slug");

-- CreateIndex
CREATE INDEX "testimonials_garage_id_is_approved_idx" ON "testimonials"("garage_id", "is_approved");

-- CreateIndex
CREATE INDEX "gallery_items_garage_id_is_published_idx" ON "gallery_items"("garage_id", "is_published");

-- CreateIndex
CREATE INDEX "gallery_items_tag_idx" ON "gallery_items"("tag");

-- AddForeignKey
ALTER TABLE "garage_hours" ADD CONSTRAINT "garage_hours_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
