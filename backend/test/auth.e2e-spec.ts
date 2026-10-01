import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import request from 'supertest'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import type { NextFunction, Request, Response } from 'express'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/database/prisma.service'
import { PinoLogger } from '../src/health/pino.logger'
import { RequestCtxMiddleware } from '../src/common/middleware/request-context.middleware'
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter'
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor'
import { currentTotp, hashPassword } from '../src/auth/crypto.util'

/**
 * Phase 3 auth e2e (api-contract §1). Requires seeded Postgres and
 * MFA_ENCRYPTION_KEY / STAFF_INVITE_CODE in the test env (backend/.env is
 * loaded by ConfigModule).
 *
 * Rerun-safety: every mutable scenario uses a fresh phone/IP derived from
 * the current time, and staff passwords mutated by the claim test are
 * restored afterwards — the suite can run repeatedly against one database.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let cfg: ConfigService

  const SEED_PW = process.env.SEED_PASSWORD ?? 'MotoraDemo#2026'
  let seq = 0

  /** Unique-per-call Kenyan mobile: +2547 + 8 digits. */
  const freshPhone = () => {
    seq += 1
    const n = (Date.now() % 90_000_000) + seq * 13
    return `+2547${String(n).padStart(8, '0').slice(-8)}`
  }
  /** Unique-per-call loopback-ish IP inside subnet `a`. */
  const freshIp = (a: number) => `10.4.${a}.${(Date.now() % 200) + 1}`

  const post = (path: string, body?: Record<string, unknown>, ip = '10.4.0.1') =>
    request(app.getHttpServer())
      .post(`/api/v1/auth${path}`)
      .set('X-Forwarded-For', ip)
      .set('User-Agent', 'jest-e2e')
      .send(body ?? {})

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

  const login = (phoneOrEmail: string, password = SEED_PW, ip = '10.4.0.1') =>
    post('/login', { phoneOrEmail, password }, ip)

  /** Register that tolerates PHONE_TAKEN from a previous run's leftover. */
  const registerOk = async (body: Record<string, unknown>, ip: string) => {
    const res = await post('/register', body, ip)
    if (res.status !== 201 && res.status !== 409) {
      throw new Error(`register failed (${res.status}): ${JSON.stringify(res.body)}`)
    }
    return res
  }

  const newCustomer = async (tag: string) => {
    const phone = freshPhone()
    const password = 'E2ePass#2026x'
    const ip = freshIp(90)
    await registerOk({ firstName: 'Test', lastName: tag, phone, password }, ip)
    const loginRes = await login(phone, password, freshIp(91)).expect(200)
    return { token: loginRes.body.data.accessToken as string, phone, password }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PinoLogger)
      .useValue({
        init: () => undefined, info: () => undefined, warn: () => undefined,
        error: () => undefined, debug: () => undefined, onModuleDestroy: () => undefined,
      })
      .compile()

    app = moduleRef.createNestApplication({ logger: false })
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] })
    app.use(helmet())
    app.use(compression())
    app.use(cookieParser())
    const requestCtx = new RequestCtxMiddleware()
    app.use((req: Request, res: Response, next: NextFunction) => requestCtx.use(req, res, next))
    cfg = app.get(ConfigService, { strict: false })
    app.enableCors({ origin: [cfg.get('FRONTEND_URL', 'http://localhost:5173')], credentials: true })
    app.useGlobalInterceptors(new EnvelopeInterceptor())
    app.useGlobalFilters(new GlobalExceptionFilter())

    await app.init()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  it('registers a customer and returns the public user shape (no hash leaks)', async () => {
    const p = freshPhone() // +2547XXXXXXXX
    // Human-formatted input ("+254 7XX XXX XXX") must normalize back to E.164.
    const display = `+254 ${p.slice(4, 7)} ${p.slice(7, 10)} ${p.slice(10, 13)}`
    const res = await post('/register', {
      firstName: 'Amina',
      lastName: 'Hassan',
      phone: display,
      password: 'StrongPass#2026',
    }, freshIp(1)).expect(201)
    const u = res.body.data.user
    expect(u.role).toBe('CUSTOMER')
    expect(u.phone).toBe(p) // normalized E.164
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
    expect(res.body.data.expiresIn).toBeGreaterThan(0)
  })

  it('rejects weak passwords and invalid phones (zod + policy)', async () => {
    await post('/register', {
      firstName: 'A', lastName: 'B', phone: '+254712000902', password: 'short',
    }, freshIp(1)).expect(400)
    await post('/register', {
      firstName: 'A', lastName: 'B', phone: '12345', password: 'StrongPass#2026',
    }, freshIp(1)).expect(400)
  })

  it('rejects duplicate phone with PHONE_TAKEN', async () => {
    const res = await post('/register', {
      firstName: 'Dup', lastName: 'Phone', phone: '0712000901', password: 'StrongPass#2026',
    }, freshIp(1)).expect(409)
    expect(res.body.error.code).toBe('PHONE_TAKEN')
  })

  it('upgrades a passwordless guest account created by a quote-request', async () => {
    const phone = freshPhone()
    // Guest booking creates a PENDING_VERIFICATION user without a password.
    await request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', freshIp(9))
      .send({ name: 'Guest Upgrade', phone, vehicleText: 'Toyota Vitz 2015' })
      .expect(201)

    const res = await post('/register', {
      firstName: 'Guest', lastName: 'Upgrade', phone: phone.replace('+254', '0'), password: 'StrongPass#2026',
    }, freshIp(9)).expect(201)
    expect(res.body.data.user.status).toBe('ACTIVE')

    const loginRes = await login(phone, 'StrongPass#2026', freshIp(9)).expect(200)
    expect(loginRes.body.data.user.role).toBe('CUSTOMER')
  })

  it('claims a seeded staff account with a valid invite code (and restores passwords)', async () => {
    const invite = cfg.get<string>('STAFF_INVITE_CODE')
    if (!invite) return // claiming disabled in this env — skip silently

    const seedHash = await hashPassword(SEED_PW)
    const mechanic = await prisma.user.findFirst({ where: { email: 'mechanic@motora.co.ke' } })
    const cashier = await prisma.user.findFirst({ where: { email: 'cashier@motora.co.ke' } })
    try {
      // Simulate pre-claim state on both accounts.
      await prisma.user.update({ where: { id: mechanic!.id }, data: { passwordHash: null } })
      await prisma.user.update({ where: { id: cashier!.id }, data: { passwordHash: null } })

      const res = await post('/register', {
        firstName: 'Peter',
        lastName: 'Otieno',
        phone: '+254700000003',
        password: 'ClaimedPass#2026',
        staffInviteCode: invite,
      }, freshIp(4)).expect(201)
      expect(res.body.data.user.role).toBe('MECHANIC') // role is seeded, not client-set
      expect(res.body.data.user.status).toBe('ACTIVE')

      // Wrong code fails closed.
      await post('/register', {
        firstName: 'Miriam', lastName: 'Kariuki', phone: '+254700000004',
        password: 'ClaimedPass#2026', staffInviteCode: 'wrong-code',
      }, freshIp(4)).expect(403)
    } finally {
      // Restore seed credentials so other suites can log these users in.
      await prisma.user.update({ where: { id: mechanic!.id }, data: { passwordHash: seedHash } })
      await prisma.user.update({ where: { id: cashier!.id }, data: { passwordHash: seedHash } })
    }
  })

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------

  it('logs in with email and with phone (seeded staff + customer)', async () => {
    const byEmail = await login('customer@motora.co.ke', SEED_PW, freshIp(2)).expect(200)
    expect(byEmail.body.data.user.email).toBe('customer@motora.co.ke')
    expect(byEmail.body.data.accessToken).toBeTruthy()

    const byPhone = await login('+254711111111', SEED_PW, freshIp(2)).expect(200)
    expect(byPhone.body.data.user.role).toBe('CUSTOMER')
  })

  it('rejects wrong password with INVALID_CREDENTIALS (no account-oracle)', async () => {
    const res = await login('customer@motora.co.ke', 'WrongPass#2026', freshIp(2)).expect(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    // Unique-per-run ghost — a fixed identifier would accumulate failures
    // across runs and hit the 15-min throttle window.
    const ghost = `nobody.${Date.now()}@nowhere.ke`
    const unknown = await login(ghost, 'Whatever#2026', freshIp(2)).expect(401)
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS')
    // Keep the shared account's failure count low for reruns.
    await prisma.loginAttempt.deleteMany({ where: { identifier: 'customer@motora.co.ke', success: false } })
  })

  it('locks the account after 5 failures (ACCOUNT_LOCKED, 423)', async () => {
    const phone = freshPhone()
    const ip = freshIp(6)
    await registerOk({ firstName: 'Lock', lastName: 'Me', phone, password: 'StrongPass#2026' }, ip)
    await prisma.user.update({ where: { phone }, data: { lockedUntil: null, failedLoginCount: 0 } })
    await prisma.loginAttempt.deleteMany({ where: { identifier: phone } })

    for (let i = 0; i < 5; i++) {
      await login(phone, 'BadPass#999999', ip).expect(401)
    }
    // 5th failure locks: next attempt answers ACCOUNT_LOCKED even with the right password.
    const res = await login(phone, 'StrongPass#2026', ip).expect(423)
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED')

    const db = await prisma.user.findUnique({ where: { phone } })
    expect(db!.lockedUntil).toBeTruthy()
  })

  it('throttles further attempts after repeated failures (RATE_LIMITED)', async () => {
    // A NON-EXISTENT identifier isolates the throttle from account lockout:
    // after 5 failures/15min on one identifier the next attempt must 429.
    const ghost = `ghost.${Date.now()}@nowhere.ke`
    const ip = freshIp(7)
    for (let i = 0; i < 5; i++) {
      await login(ghost, 'BadPass#999999', ip).expect(401)
    }
    // 6th failure inside the window → throttle answer (contract §1).
    const res = await login(ghost, 'BadPass#999999', ip).expect(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
  })

  it('records login attempts + security events for failures', async () => {
    const ip = freshIp(8)
    const phone = freshPhone()
    await registerOk({ firstName: 'Audit', lastName: 'Me', phone, password: 'StrongPass#2026' }, ip)
    await login(phone, 'BadPass#999999', ip).expect(401)

    const attempt = await prisma.loginAttempt.findFirst({
      where: { ip, success: false, identifier: phone },
      orderBy: { createdAt: 'desc' },
    })
    expect(attempt).toBeTruthy()
    const user = await prisma.user.findUnique({ where: { phone } })
    const evt = await prisma.securityEvent.findFirst({
      where: { eventType: 'FAILED_LOGIN', userId: user!.id, resource: 'login' },
      orderBy: { createdAt: 'desc' },
    })
    expect(evt).toBeTruthy()
  })

  // ------------------------------------------------------------------
  // Refresh rotation + reuse detection
  // ------------------------------------------------------------------

  it('rotates the refresh cookie; reusing the old token revokes everything', async () => {
    const phone = freshPhone()
    await registerOk({ firstName: 'Rot', lastName: 'Ator', phone, password: 'StrongPass#2026' }, freshIp(31))
    const loginRes = await login(phone, 'StrongPass#2026', freshIp(32)).expect(200)
    const cookie = extractCookie(loginRes)
    expect(cookie).toBeTruthy()

    const r1 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('Cookie', cookie!).set('X-Forwarded-For', freshIp(33)).expect(200)
    expect(r1.body.data.accessToken).toBeTruthy()
    const cookie2 = extractCookie(r1)
    expect(cookie2).toBeTruthy()
    expect(cookie2).not.toBe(cookie) // rotated

    // Reuse of the rotated token → TOKEN_REVOKED and ALL sessions nuked.
    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('Cookie', cookie!).set('X-Forwarded-For', freshIp(34)).expect(401)
    expect(reuse.body.error.code).toBe('TOKEN_REVOKED')
    const user = await prisma.user.findUnique({ where: { phone } })
    const active = await prisma.refreshSession.count({ where: { userId: user!.id, revokedAt: null } })
    expect(active).toBe(0)

    // …and even the NEW cookie is dead now.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('Cookie', cookie2!).set('X-Forwarded-For', freshIp(35)).expect(401)
  })

  it('answers refresh without a cookie with INVALID_TOKEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('X-Forwarded-For', freshIp(36)).expect(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  it('refresh rejects garbage tokens with INVALID_TOKEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'motora_refresh=garbage-token-value')
      .set('X-Forwarded-For', freshIp(37))
      .expect(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  // ------------------------------------------------------------------
  // Sessions / logout / password
  // ------------------------------------------------------------------

  it('lists own sessions and revokes one by id', async () => {
    const { token } = await newCustomer('Sessions')
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions').set(bearer(token)).expect(200)
    expect(Array.isArray(listRes.body.data.sessions)).toBe(true)
    expect(listRes.body.data.sessions.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(listRes.body)).not.toContain('refreshTokenHash')
    const sid = listRes.body.data.sessions[0].id

    await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${sid}`).set(bearer(token)).expect(200)
    const after = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions').set(bearer(token)).expect(200)
    expect(after.body.data.sessions.some((s: { id: string }) => s.id === sid)).toBe(false)
  })

  it('cannot revoke another user’s session (404, no existence leak)', async () => {
    const a = await newCustomer('SessionA')
    const b = await newCustomer('SessionB')
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions').set(bearer(a.token)).expect(200)
    const sid = listRes.body.data.sessions[0].id
    await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${sid}`).set(bearer(b.token)).expect(404)
  })

  it('logout revokes the presented session; token no longer refreshes', async () => {
    const phone = freshPhone()
    await registerOk({ firstName: 'Out', lastName: 'Log', phone, password: 'StrongPass#2026' }, freshIp(41))
    const loginRes = await login(phone, 'StrongPass#2026', freshIp(42)).expect(200)
    const access = loginRes.body.data.accessToken as string
    const cookie = extractCookie(loginRes)!

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set(bearer(access))
      .set('Cookie', cookie)
      .set('X-Forwarded-For', freshIp(43))
      .expect(200)

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', freshIp(44))
      .expect(401)
  })

  it('changes password, revoking other sessions; old password stops working', async () => {
    const phone = freshPhone()
    await registerOk({ firstName: 'Pass', lastName: 'Change', phone, password: 'FirstPass#2026' }, freshIp(51))

    // Two devices log in.
    const d1 = await login(phone, 'FirstPass#2026', freshIp(52)).expect(200)
    const d2 = await login(phone, 'FirstPass#2026', freshIp(53)).expect(200)

    await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set(bearer(d1.body.data.accessToken))
      .send({ currentPassword: 'WrongPass#2026', newPassword: 'SecondPass#2026' })
      .expect(401) // wrong current password

    await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set(bearer(d1.body.data.accessToken))
      .send({ currentPassword: 'FirstPass#2026', newPassword: 'short' })
      .expect(400) // weak

    await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set(bearer(d1.body.data.accessToken))
      .send({ currentPassword: 'FirstPass#2026', newPassword: 'SecondPass#2026' })
      .expect(200)

    // Device 2 was signed out; its refresh cookie is revoked.
    const cookie2 = extractCookie(d2)!
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie2)
      .set('X-Forwarded-For', freshIp(54))
      .expect(401)

    // Old password dead, new one live.
    await login(phone, 'FirstPass#2026', freshIp(55)).expect(401)
    await login(phone, 'SecondPass#2026', freshIp(56)).expect(200)
  })

  // ------------------------------------------------------------------
  // MFA (admin) + RBAC
  // ------------------------------------------------------------------

  it('enrolls and verifies TOTP for an admin; login then demands a code', async () => {
    // Defensive reset so reruns can enroll even after a crashed run.
    const owner = await prisma.user.findFirst({ where: { email: 'owner@motora.co.ke' } })
    await prisma.mfaFactor.deleteMany({ where: { userId: owner!.id } })
    await prisma.user.update({ where: { id: owner!.id }, data: { mfaEnforced: false, lockedUntil: null, failedLoginCount: 0 } })
    await prisma.loginAttempt.deleteMany({ where: { identifier: 'owner@motora.co.ke' } })

    const loginRes = await login('owner@motora.co.ke', SEED_PW, freshIp(61)).expect(200)
    const token = loginRes.body.data.accessToken as string

    const enroll = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/enroll')
      .set(bearer(token))
      .set('X-Forwarded-For', freshIp(62))
      .expect(200)
    const { secret, otpauthUrl } = enroll.body.data
    expect(secret).toBeTruthy()
    expect(otpauthUrl).toContain('otpauth://totp/')
    expect(otpauthUrl).toContain('MOTORA')

    // Confirm with a live code generated from the returned secret.
    const code = await currentTotp(secret)
    await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .set(bearer(token))
      .set('X-Forwarded-For', freshIp(63))
      .send({ code })
      .expect(200)

    // Double-enroll → MFA_ALREADY_ENROLLED.
    const again = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/enroll')
      .set(bearer(token))
      .set('X-Forwarded-For', freshIp(62))
      .expect(409)
    expect(again.body.error.code).toBe('MFA_ALREADY_ENROLLED')

    // Login without code → mfaRequired flag (200).
    const challenge = await login('owner@motora.co.ke', SEED_PW, freshIp(64)).expect(200)
    expect(challenge.body.data.mfaRequired).toBe(true)
    expect(challenge.body.data.accessToken).toBeUndefined()

    // Login with a WRONG code → MFA_INVALID.
    const bad = await post('/login', { phoneOrEmail: 'owner@motora.co.ke', password: SEED_PW, mfaCode: '000000' }, freshIp(65))
      .expect(401)
    expect(bad.body.error.code).toBe('MFA_INVALID')

    // Login with a real code → tokens.
    const good = await currentTotp(secret)
    const done = await post('/login', { phoneOrEmail: 'owner@motora.co.ke', password: SEED_PW, mfaCode: good }, freshIp(66))
      .expect(200)
    expect(done.body.data.accessToken).toBeTruthy()
    expect(done.body.data.mfaRequired).toBeUndefined()

    // Clean up so reruns can enroll again, and don't leave failures behind.
    await prisma.mfaFactor.deleteMany({ where: { userId: owner!.id } })
    await prisma.user.update({ where: { id: owner!.id }, data: { mfaEnforced: false, failedLoginCount: 0 } })
    await prisma.loginAttempt.deleteMany({ where: { identifier: 'owner@motora.co.ke' } })
  })

  it('forbids CUSTOMER from MFA enrollment (ADMIN+ only)', async () => {
    const { token } = await newCustomer('NoMfa')
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/enroll')
      .set(bearer(token))
      .set('X-Forwarded-For', freshIp(67))
      .expect(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('rejects protected endpoints without a token (401)', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/sessions').expect(401)
    await request(app.getHttpServer()).post('/api/v1/auth/password').send({}).expect(401)
  })

  it('accepts fresh logins after all the revocations above', async () => {
    const res = await login('customer@motora.co.ke', SEED_PW, freshIp(71)).expect(200)
    expect(res.body.data.user.role).toBe('CUSTOMER')
  })
})

/** Pulls the Set-Cookie value for the refresh cookie out of a response. */
function extractCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const cookies = res.headers['set-cookie'] as string[] | string | undefined
  const raw = Array.isArray(cookies) ? cookies.find((c) => c.startsWith('motora_refresh=')) : cookies
  return typeof raw === 'string' && raw.startsWith('motora_refresh=') ? raw.split(';')[0] : undefined
}
