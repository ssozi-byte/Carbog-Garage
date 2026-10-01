import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual, createHmac } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

/**
 * Central crypto utilities (Spec §27). All secrets stay server-side.
 *
 * Argon2id parameters follow OWASP's current recommendation
 * (m=19454 KiB, t=2, p=1) — the same profile the seed uses.
 */
const ARGON2_OPTS = { memoryCost: 19454, timeCost: 2, parallelism: 1 } as const

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS)
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashValue, plain)
  } catch {
    return false
  }
}

/** Opaque refresh tokens: 256-bit random, URL-safe; only the sha256 is stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) {
    // Still burn a comparison to keep timing flat-ish.
    timingSafeEqual(ab, ab)
    return false
  }
  return timingSafeEqual(ab, bb)
}

// ---------------- TOTP / MFA (RFC 6238, hand-rolled) ----------------
// otplib v13 ships ESM-only and breaks the CJS toolchain (ts-node/jest),
// so TOTP is implemented directly on node:crypto. Defaults match Google
// Authenticator: SHA-1, 6 digits, 30-second step, Base32 secrets (RFC 4648).

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Base32 secret compatible with Google Authenticator & friends (160-bit). */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20)
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function totpUri(secret: string, accountLabel: string, issuer = 'MOTORA'): string {
  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  )
}

/** Code for a secret at a given instant (defaults to now). */
export function currentTotp(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 30_000)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter % 2 ** 32, 4)
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString()
  return code.padStart(6, '0')
}

/** Verifies a 6-digit code with ±1 window (30s each) of clock-drift tolerance. */
export function verifyTotp(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false
  for (const drift of [0, -30_000, 30_000]) {
    if (safeEqual(currentTotp(secret, Date.now() + drift), token)) return true
  }
  return false
}

// ---------------- AES-256-GCM secret storage ----------------

function mfaKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY
  if (!raw || raw.length < 32) {
    // Fail loud: silently weak key storage would be worse.
    throw new Error('MFA_ENCRYPTION_KEY missing or shorter than 32 chars.')
  }
  // Derive a stable 32-byte key from the configured secret.
  return createHash('sha256').update(raw).digest()
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', mfaKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv.toString('base64'), enc.toString('base64'), cipher.getAuthTag().toString('base64')].join('.')
}

export async function decryptSecret(payload: string): Promise<string> {
  const [ivB64, dataB64, tagB64] = payload.split('.')
  const decipher = createDecipheriv('aes-256-gcm', mfaKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

/** Password strength: ≥10 chars, letter + number (Spec §27 "secure password rules"). */
export function isStrongPassword(pw: string): boolean {
  return typeof pw === 'string' && pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw)
}
