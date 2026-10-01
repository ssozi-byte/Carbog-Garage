import { createHash, createHmac } from 'node:crypto'

/**
 * Minimal AWS Signature V4 presigner for S3-compatible object stores
 * (AWS S3, MinIO). Path-style addressing, UNSIGNED-PAYLOAD uploads —
 * hand-rolled to avoid dragging the AWS SDK into the dependency tree
 * (same philosophy as the TOTP implementation in auth/crypto.util.ts).
 *
 * Verified shape: PUT/GET presigned query URLs per the SigV4 spec.
 * Real storage round-trips are exercised in Phase 9 when MinIO is
 * provisioned; unit tests pin determinism here.
 */

export interface PresignConfig {
  accessKey: string
  secretKey: string
  region: string
  bucket: string
  /** e.g. http://localhost:9002 (MinIO) or https://s3.amazonaws.com */
  endpoint: string
  expirySeconds: number
}

function uriEncode(value: string, encodeSlash = true): string {
  let out = ''
  for (const ch of value) {
    if (/[A-Za-z0-9_.~-]/.test(ch)) out += ch
    else if (ch === '/') out += encodeSlash ? '%2F' : '/'
    else out += '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

/**
 * Presigns an object PUT or GET. Returns the full URL (signature included).
 * The object key must already be server-generated and path-safe.
 */
export function presignObject(
  cfg: PresignConfig,
  method: 'PUT' | 'GET',
  key: string,
): { url: string; expiresAt: Date } {
  const endpoint = new URL(cfg.endpoint)
  const host = endpoint.host // includes port when present
  const canonicalUri = `/${cfg.bucket}/${key.split('/').map((s) => uriEncode(s)).join('/')}`

  const now = new Date()
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}Z`.slice(0, 16) + 'Z'
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`

  // Canonical query — must be sorted by key; signature param excluded.
  const query = new Map<string, string>([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${cfg.accessKey}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(cfg.expirySeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ])
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join('&')

  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(`AWS4${cfg.secretKey}`, dateStamp)
  const kRegion = hmac(kDate, cfg.region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const url = `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
  return { url, expiresAt: new Date(now.getTime() + cfg.expirySeconds * 1000) }
}
