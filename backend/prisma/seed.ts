// MOTORA — Phase 2 seed (idempotent: run repeatedly, no duplicates)
// Content mirrors src/data/* of the existing frontend exactly (Rule 1/4).
import { PrismaClient, UserRole, UserStatus } from '@prisma/client'
import { hash } from '@node-rs/argon2'

const prisma = new PrismaClient()

// Argon2id defaults (OWASP: m=19454,t=2,p=1) — verify only needs `verify()`.
const HASH_OPTS = { memoryCost: 19454, timeCost: 2, parallelism: 1 } as const

const GARAGE = {
  name: 'MOTORA Garage',
  slug: 'motora-kilimani',
  phone: '+254712345678',
  whatsappNumber: '+254712345678',
  email: 'service@motora.co.ke',
  address: 'Ngong Lane Plaza, Off Ngong Road',
  city: 'Nairobi',
  county: 'Nairobi',
  latitude: -1.2921,
  longitude: 36.7819,
  brandsServiced: [
    'Toyota', 'Subaru', 'Nissan', 'Mazda', 'Honda', 'Mitsubishi',
    'Mercedes', 'Isuzu', 'Volkswagen', 'Land Rover', 'Suzuki', 'Hyundai',
  ],
  stats: [
    { value: '10+', label: 'Years of experience' },
    { value: '2,000+', label: 'Vehicles serviced' },
    { value: '4.9★', label: 'Customer rating' },
    { value: '12', label: 'Certified technicians' },
  ],
  socials: [
    { label: 'Instagram', href: '#' },
    { label: 'Facebook', href: '#' },
    { label: 'TikTok', href: '#' },
    { label: 'YouTube', href: '#' },
  ],
}

const HOURS = [
  { dayOfWeek: 1, opensAt: '08:00', closesAt: '18:00', isClosed: false },
  { dayOfWeek: 2, opensAt: '08:00', closesAt: '18:00', isClosed: false },
  { dayOfWeek: 3, opensAt: '08:00', closesAt: '18:00', isClosed: false },
  { dayOfWeek: 4, opensAt: '08:00', closesAt: '18:00', isClosed: false },
  { dayOfWeek: 5, opensAt: '08:00', closesAt: '18:00', isClosed: false },
  { dayOfWeek: 6, opensAt: '08:00', closesAt: '16:00', isClosed: false },
  { dayOfWeek: 0, opensAt: null, closesAt: null, isClosed: true },
]

// Marketing cards (CORE, numbered 01–06 like the original UI) + bookable
// catalog entries (BOOKING_ONLY, incl. the contact-form options) + extras.
const SERVICES = [
  { slug: 'vehicle-diagnostics', name: 'Vehicle Diagnostics', displayNum: '01', iconKey: 'plug', category: 'CORE', description: 'Computer diagnostics and fault detection for engine, transmission and electrical systems.', points: ['OBD & dealer-level scanners', 'Fault code reading & clearing', 'Pre-purchase inspection'], est: 60, base: 250000 },
  { slug: 'engine-repair', name: 'Engine Service & Repair', displayNum: '02', iconKey: 'engine', category: 'CORE', description: 'From routine oil services to full engine rebuilds, done right the first time.', points: ['Oil & filter service', 'Timing belts & chains', 'Head gasket & rebuilds'], est: 240, base: 1500000 },
  { slug: 'brakes', name: 'Brake Systems', displayNum: '03', iconKey: 'brake', category: 'CORE', description: 'Brake inspection, pad and disc replacement, and ABS fault diagnosis.', points: ['Pads, discs & drums', 'Brake fluid flush', 'ABS diagnostics'], est: 90, base: 800000 },
  { slug: 'suspension', name: 'Suspension & Steering', displayNum: '04', iconKey: 'shock', category: 'CORE', description: 'Shocks, bushes, ball joints and control arms — for a smooth, safe ride.', points: ['Shocks & struts', 'Bushes & ball joints', 'Control arms'], est: 120, base: 900000 },
  { slug: 'ac-cooling', name: 'AC & Cooling', displayNum: '05', iconKey: 'snow', category: 'CORE', description: 'Air conditioning diagnostics, gas recharge and full cooling system service.', points: ['AC gas recharge', 'Compressor repair', 'Radiator & thermostat'], est: 120, base: 700000 },
  { slug: 'auto-electrical', name: 'Auto Electrical', displayNum: '06', iconKey: 'bolt', category: 'CORE', description: 'Batteries, alternators, starters and wiring faults traced and fixed properly.', points: ['Battery & charging system', 'Alternators & starters', 'Wiring fault tracing'], est: 90, base: 550000 },
  { slug: 'general-service', name: 'General Service', iconKey: 'engine', category: 'BOOKING_ONLY', description: 'Full oil and filter service with a comprehensive safety inspection.', points: ['Oil & filter service', 'Fluid top-ups', 'Safety inspection'], est: 90, base: 650000 },
  { slug: 'not-sure-please-diagnose', name: 'Not sure — please diagnose', iconKey: 'plug', category: 'BOOKING_ONLY', description: 'Bring it in — we inspect, diagnose and quote before any work starts.', points: ['Full vehicle inspection', 'Written findings & quote'], est: 60, base: 250000 },
  { slug: 'wheel-services', name: 'Wheel Services', iconKey: 'tyre', category: 'EXTRA', description: 'Wheel alignment, balancing and tyre fitting.', points: ['Alignment, balancing, tyres'], est: 60, base: 350000 },
  // Phase 6: wash packages (category=WASH → work orders spawn type=WASH + a
  // wash_jobs row; the washer drives the QUEUED→…→READY step machine).
  { slug: 'exterior-wash', name: 'Exterior Wash', iconKey: 'droplet', category: 'WASH', description: 'Pressure wash, snow foam and hand dry — the outside shines again.', points: ['Pressure wash & snow foam', 'Hand dry & shine'], est: 30, base: 50000 },
  { slug: 'wash-vacuum', name: 'Wash & Vacuum', iconKey: 'droplet', category: 'WASH', description: 'Full exterior wash plus interior vacuum and dash wipe.', points: ['Full exterior wash', 'Interior vacuum', 'Dash & trim wipe'], est: 45, base: 80000 },
  { slug: 'full-detail-wash', name: 'Full Detail Wash', iconKey: 'sparkles', category: 'WASH', description: 'The works: wash, vacuum, interior detail and hand polish.', points: ['Wash & vacuum', 'Interior detailing', 'Hand polish'], est: 90, base: 150000 },
  { slug: 'breakdown-assistance', name: 'Breakdown Assistance', iconKey: 'phone', category: 'EXTRA', description: 'Stuck on the road? Roadside support within Nairobi.', points: ['Roadside support within Nairobi'], est: 30 },
  { slug: 'fleet-commercial', name: 'Fleet & Commercial', iconKey: 'truck', category: 'EXTRA', description: 'Scheduled servicing for company fleets, matatus and light trucks.', points: ['Scheduled fleet servicing, matatus, light trucks'], est: 180 },
]

const TESTIMONIALS = [
  { authorName: 'Brian M.', authorArea: 'Kilimani, Nairobi', vehicle: 'Subaru Forester', rating: 5, quote: 'Had my Subaru serviced here. They explained everything before starting the work, sent photos of the worn parts, and the final bill matched the quote exactly.', featured: true, order: 1 },
  { authorName: 'Grace W.', authorArea: 'Kileleshwa, Nairobi', vehicle: 'Toyota Probox', rating: 5, quote: 'My Probox was overheating and two other garages could not find the cause. MOTORA traced it to a blocked radiator in one afternoon. Honest people.', order: 2 },
  { authorName: 'David O.', authorArea: 'Industrial Area, Nairobi', vehicle: 'Fleet — Isuzu trucks', rating: 5, quote: 'We run a small delivery fleet and they keep all four trucks on schedule. Service reminders, clear invoices, no surprise costs. Very professional.', order: 3 },
  { authorName: 'Achieng’ T.', authorArea: 'South B, Nairobi', vehicle: 'Mazda Demio', rating: 5, quote: 'Booked on WhatsApp on my way to work and the car was ready by evening. The AC recharge has never worked this well. Highly recommended.', order: 4 },
  { authorName: 'Kamau J.', authorArea: 'Ruiru, Kiambu', vehicle: 'Nissan X-Trail', rating: 5, quote: 'They refused to replace parts that did not need replacing. That alone earned my trust. My X-Trail now comes here for everything.', order: 5 },
  { authorName: 'Fatuma A.', authorArea: 'Langata, Nairobi', vehicle: 'Toyota Noah', rating: 5, quote: 'Genuine parts, proper diagnosis and they gave me a written report after the service. This is how a garage should be run.', order: 6 },
]

const GALLERY = [
  { title: 'Engine Rebuild', vehicleLabel: 'Toyota Premio', tag: 'ENGINE', externalUrl: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1200&q=70', order: 1 },
  { title: 'Full Brake Overhaul', vehicleLabel: 'Subaru Forester', tag: 'BRAKES', externalUrl: 'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?auto=format&fit=crop&w=1200&q=70', order: 2 },
  { title: 'Suspension Repair', vehicleLabel: 'Nissan X-Trail', tag: 'SUSPENSION', externalUrl: 'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1200&q=70', order: 3 },
  { title: 'Diagnostics & Tuning', vehicleLabel: 'Mazda Demio', tag: 'DIAGNOSTICS', externalUrl: 'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=1200&q=70', order: 4 },
  { title: 'AC System Rebuild', vehicleLabel: 'Toyota Fielder', tag: 'AC_COOLING', externalUrl: 'https://images.unsplash.com/photo-1504222490345-c075b6008014?auto=format&fit=crop&w=1200&q=70', order: 5 },
  { title: 'Electrical Fault Trace', vehicleLabel: 'Isuzu D-Max', tag: 'ELECTRICAL', externalUrl: 'https://images.unsplash.com/photo-1519245659620-e859806a8d3b?auto=format&fit=crop&w=1200&q=70', order: 6 },
]

const STAFF = [
  { firstName: 'MOTORA', lastName: 'Owner', role: 'SUPER_ADMIN', phone: '+254700000001', email: 'owner@motora.co.ke' },
  { firstName: 'Jane', lastName: 'Wanjiku', role: 'SERVICE_ADVISOR', phone: '+254700000002', email: 'advisor@motora.co.ke' },
  { firstName: 'Peter', lastName: 'Otieno', role: 'MECHANIC', phone: '+254700000003', email: 'mechanic@motora.co.ke' },
  { firstName: 'Miriam', lastName: 'Kariuki', role: 'CASHIER', phone: '+254700000004', email: 'cashier@motora.co.ke' },
  // Phase 5D: the storekeeper — issues parts against parts_requests.
  { firstName: 'Samuel', lastName: 'Njoroge', role: 'INVENTORY_MANAGER', phone: '+254700000005', email: 'storekeeper@motora.co.ke' },
  // Phase 6: the washer — drives the wash_jobs step machine (§2.2).
  { firstName: 'Brian', lastName: 'Kimani', role: 'WASHER', phone: '+254700000006', email: 'washer@motora.co.ke' },
]

// ---------------- Phase 5B: standard DVI checklist (33 items, 8 sections) ----------------
// Matches docs/platform-roadmap-v2.md §2.3: status + measurement + photo per
// point. measurementUnit enables the numeric field; severity maps define the
// finding severity auto-assigned per result status.

const SEV = { watch: 'WATCH', attention: 'ATTENTION', critical: 'CRITICAL' }

const DVI_TEMPLATE = {
  name: 'Standard DVI',
  items: [
    // A. Exterior
    { section: 'Exterior', label: 'Body damage & dents', order: 1 },
    { section: 'Exterior', label: 'Windscreen & glass', order: 2 },
    { section: 'Exterior', label: 'Lights & indicators', order: 3 },
    { section: 'Exterior', label: 'Mirrors', order: 4 },
    { section: 'Exterior', label: 'Wipers & washers', order: 5 },
    { section: 'Exterior', label: 'Number plates', order: 6 },
    // B. Tyres
    { section: 'Tyres', label: 'Front left tyre', order: 7, unit: 'mm', tread: true },
    { section: 'Tyres', label: 'Front right tyre', order: 8, unit: 'mm', tread: true },
    { section: 'Tyres', label: 'Rear left tyre', order: 9, unit: 'mm', tread: true },
    { section: 'Tyres', label: 'Rear right tyre', order: 10, unit: 'mm', tread: true },
    { section: 'Tyres', label: 'Spare tyre & jack', order: 11 },
    { section: 'Tyres', label: 'Wheel alignment & uneven wear', order: 12 },
    // C. Brakes
    { section: 'Brakes', label: 'Front brake pads', order: 13, unit: 'mm' },
    { section: 'Brakes', label: 'Rear brake pads', order: 14, unit: 'mm' },
    { section: 'Brakes', label: 'Brake discs & drums', order: 15, unit: 'mm' },
    { section: 'Brakes', label: 'Brake fluid level & condition', order: 16, unit: '%' },
    { section: 'Brakes', label: 'Handbrake & pedal feel', order: 17 },
    // D. Engine
    { section: 'Engine', label: 'Engine oil level & condition', order: 18 },
    { section: 'Engine', label: 'Coolant level, hoses & radiator', order: 19 },
    { section: 'Engine', label: 'Drive belts', order: 20 },
    { section: 'Engine', label: 'Power steering fluid', order: 21 },
    { section: 'Engine', label: 'Oil / coolant / fuel leaks', order: 22 },
    // E. Electrical
    { section: 'Electrical', label: 'Battery voltage & terminals', order: 23, unit: 'V' },
    { section: 'Electrical', label: 'Charging system (alternator)', order: 24, unit: 'V' },
    { section: 'Electrical', label: 'Horn', order: 25 },
    { section: 'Electrical', label: 'Dashboard warning lights', order: 26 },
    // F. Suspension
    { section: 'Suspension', label: 'Shock absorbers & struts', order: 27 },
    { section: 'Suspension', label: 'Bushes & ball joints', order: 28 },
    { section: 'Suspension', label: 'Steering play & rack', order: 29 },
    // G. Interior
    { section: 'Interior', label: 'AC & blower performance', order: 30 },
    { section: 'Interior', label: 'Seat belts & central locking', order: 31 },
    // H. Diagnostics
    { section: 'Diagnostics', label: 'OBD scan & error codes', order: 32 },
    { section: 'Diagnostics', label: 'Test drive & road noise', order: 33 },
  ],
}

const DEMO_CUSTOMER = {
  firstName: 'Brian',
  lastName: 'Mwangi',
  phone: '+254711111111',
  email: 'customer@motora.co.ke',
  vehicles: [
    { registrationNumber: 'KDA123A', make: 'Toyota', model: 'Fielder', year: 2016, fuelType: 'PETROL', transmission: 'AUTOMATIC', mileage: 84500 },
    { registrationNumber: 'KCX456B', make: 'Subaru', model: 'Forester', year: 2014, fuelType: 'PETROL', transmission: 'AUTOMATIC', mileage: 132000 },
  ],
}

function time(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2000, 0, 1, h, m))
}

async function main() {
  console.log('Seeding MOTORA database…')

  // --- Garage + hours (upsert = idempotent) ---
  const garage = await prisma.garage.upsert({
    where: { slug: GARAGE.slug },
    update: {},
    create: GARAGE,
  })

  for (const h of HOURS) {
    const data = {
      dayOfWeek: h.dayOfWeek,
      opensAt: h.opensAt ? time(h.opensAt) : null,
      closesAt: h.closesAt ? time(h.closesAt) : null,
      isClosed: h.isClosed,
    }
    const existing = await prisma.garageHour.findFirst({
      where: { garageId: garage.id, dayOfWeek: h.dayOfWeek },
    })
    if (existing) await prisma.garageHour.update({ where: { id: existing.id }, data })
    else await prisma.garageHour.create({ data: { ...data, garageId: garage.id } })
  }

  // --- Users (staff + demo customer), Argon2id hashed ---
  const demoPassword = process.env.SEED_PASSWORD ?? 'MotoraDemo#2026'
  const passwordHash = await hash(demoPassword, HASH_OPTS)

  for (const s of STAFF) {
    await prisma.user.upsert({
      where: { phone: s.phone },
      update: {},
      create: {
        garageId: garage.id,
        phone: s.phone,
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        role: s.role,
        status: UserStatus.ACTIVE,
        passwordHash,
        mfaEnforced: s.role === 'SUPER_ADMIN' || s.role === 'ADMIN',
      },
    })
  }

  const customer = await prisma.user.upsert({
    where: { phone: DEMO_CUSTOMER.phone },
    update: {},
    create: {
      garageId: garage.id,
      phone: DEMO_CUSTOMER.phone,
      email: DEMO_CUSTOMER.email,
      firstName: DEMO_CUSTOMER.firstName,
      lastName: DEMO_CUSTOMER.lastName,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      passwordHash,
    },
  })
  await prisma.customerProfile.upsert({
    where: { userId: customer.id },
    update: {},
    create: { userId: customer.id, garageId: garage.id, city: 'Kilimani, Nairobi' },
  })

  // --- Phase 5B: standard DVI template + items (idempotent) ---
  const existingTemplate = await prisma.inspectionTemplate.findFirst({
    where: { garageId: garage.id, name: DVI_TEMPLATE.name },
    include: { items: true },
  })
  if (!existingTemplate) {
    const template = await prisma.inspectionTemplate.create({
      data: { garageId: garage.id, name: DVI_TEMPLATE.name, version: 1, isActive: true },
    })
    await prisma.inspectionItem.createMany({
      data: DVI_TEMPLATE.items.map((it) => ({
        templateId: template.id,
        section: it.section,
        label: it.label,
        displayOrder: it.order,
        measurementUnit: it.unit ?? null,
        allowPhoto: true,
        watchSeverity: SEV.watch,
        needsAttentionSeverity: SEV.attention,
        criticalSeverity: SEV.critical,
      })),
    })
    console.log(`Seeded DVI template (${DVI_TEMPLATE.items.length} items)`)
  } else {
    // Keep the checklist in sync: create missing items, update labels/order.
    for (const it of DVI_TEMPLATE.items) {
      const existing = existingTemplate.items.find((x) => x.label === it.label)
      if (!existing) {
        await prisma.inspectionItem.create({
          data: {
            templateId: existingTemplate.id,
            section: it.section,
            label: it.label,
            displayOrder: it.order,
            measurementUnit: it.unit ?? null,
            allowPhoto: true,
            watchSeverity: SEV.watch,
            needsAttentionSeverity: SEV.attention,
            criticalSeverity: SEV.critical,
          },
        })
      }
    }
  }

  // --- Phase 5D: demo parts (idempotent by garage+sku) ---
  const DEMO_PARTS = [
    { sku: 'BRK-PADS-F-001', name: 'Front brake pad set (Fielder/Premio)', manufacturer: 'NTB', partNumber: 'NTB-04465', unitCostCents: 210_000, sellingPriceCents: 450_000, quantityOnHand: 8, reorderLevel: 3 },
    { sku: 'OIL-5W30-4L', name: 'Engine oil 5W-30 semi-synth 4L', manufacturer: 'Total', partNumber: 'TOT-5W30-4', unitCostCents: 280_000, sellingPriceCents: 520_000, quantityOnHand: 20, reorderLevel: 6 },
    { sku: 'FLT-AIR-TOY-02', name: 'Air filter (Toyota)', manufacturer: 'Denso', partNumber: 'DNS-17801', unitCostCents: 60_000, sellingPriceCents: 120_000, quantityOnHand: 12, reorderLevel: 4 },
  ]
  for (const p of DEMO_PARTS) {
    await prisma.part.upsert({
      where: { garageId_sku: { garageId: garage.id, sku: p.sku } },
      update: {},
      create: { ...p, garageId: garage.id },
    })
  }

  // --- Demo vehicles ---
  for (const v of DEMO_CUSTOMER.vehicles) {
    const existing = await prisma.vehicle.findFirst({
      where: { garageId: garage.id, customerId: customer.id, registrationNumber: v.registrationNumber },
    })
    if (!existing) await prisma.vehicle.create({ data: { ...v, garageId: garage.id, customerId: customer.id } })
  }

  // --- Services / testimonials / gallery (seed-once) ---
  for (const [i, s] of SERVICES.entries()) {
    const existing = await prisma.service.findFirst({ where: { garageId: garage.id, slug: s.slug } })
    if (!existing) {
      const { est, base, ...rest } = s
      await prisma.service.create({
        data: {
          ...rest,
          estimatedDurationMinutes: est,
          basePrice: base,
          garageId: garage.id,
          displayOrder: i + 1,
        },
      })
    } else {
      // Keep already-seeded rows in sync (title/num/category/copy updates)
      const { est, base, ...rest } = s
      await prisma.service.update({
        where: { id: existing.id },
        data: {
          ...rest,
          estimatedDurationMinutes: est,
          basePrice: base,
          displayOrder: i + 1,
        },
      })
    }
  }

  for (const t of TESTIMONIALS) {
    const existing = await prisma.testimonial.findFirst({
      where: { garageId: garage.id, authorName: t.authorName },
    })
    if (!existing) {
      await prisma.testimonial.create({
        data: {
          garageId: garage.id,
          authorName: t.authorName,
          authorArea: t.authorArea,
          vehicle: t.vehicle,
          rating: t.rating,
          quote: t.quote,
          isApproved: true,
          isFeatured: Boolean(t.featured),
          displayOrder: t.order,
          source: 'MANUAL',
        },
      })
    }
  }

  for (const g of GALLERY) {
    const existing = await prisma.galleryItem.findFirst({
      where: { garageId: garage.id, title: g.title },
    })
    if (!existing) {
      const { order, ...rest } = g
      await prisma.galleryItem.create({
        data: { ...rest, displayOrder: order, garageId: garage.id },
      })
    }
  }

  const counts = {
    garages: await prisma.garage.count(),
    hours: await prisma.garageHour.count(),
    users: await prisma.user.count(),
    vehicles: await prisma.vehicle.count(),
    services: await prisma.service.count(),
    testimonials: await prisma.testimonial.count(),
    galleryItems: await prisma.galleryItem.count(),
  }
  console.log('Seed complete:', counts)
  console.log(`Demo logins (password: ${demoPassword}):`)
  console.log('  owner@motora.co.ke (SUPER_ADMIN) · advisor@motora.co.ke · mechanic@motora.co.ke · cashier@motora.co.ke · storekeeper@motora.co.ke (INVENTORY_MANAGER) · washer@motora.co.ke (WASHER) · customer@motora.co.ke')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
