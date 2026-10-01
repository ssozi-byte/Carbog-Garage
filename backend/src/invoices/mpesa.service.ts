import { Injectable } from '@nestjs/common'
import { ApiError } from '../common/errors/error-codes'

export interface StkPushResult {
  simulated: boolean
  merchantRequestId?: string
  checkoutRequestId?: string
}

/**
 * M-Pesa Daraja STK push (Phase 5E, roadmap original §6/§7 content; §14/§15:
 * sandbox in dev, never real creds in code). Without MPESA_* env the API is
 * fail-closed: MPESA push returns 503 PAYMENT_PROVIDER_NOT_CONFIGURED, while
 * CASH and the callback simulator keep working — CI needs no credentials.
 */
@Injectable()
export class MpesaService {
  private configured(): boolean {
    return !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE && process.env.MPESA_PASSKEY)
  }

  private async accessToken(): Promise<string> {
    const base = process.env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke'
    const basic = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64')
    const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
    })
    if (!res.ok) {
      throw new ApiError('PAYMENT_PROVIDER_ERROR', 'M-Pesa authentication failed.', 502)
    }
    const body = (await res.json()) as { access_token: string }
    return body.access_token
  }

  /**
   * Initiates an STK push for `amountCents` (integer cents → whole KES on the
   * wire; Daraja takes whole shillings). Timestamps/password per Daraja spec;
   * the passkey never leaves this function (§2.20: mpesa_requests never
   * stores credentials).
   */
  async stkPush(phoneNumber: string, amountCents: number, reference: string): Promise<StkPushResult> {
    if (!this.configured()) {
      throw new ApiError(
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'M-Pesa is not configured (MPESA_* env unset); use CASH or the callback simulator.',
        503,
      )
    }
    const base = process.env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke'
    const shortcode = process.env.MPESA_SHORTCODE!
    const passkey = process.env.MPESA_PASSKEY!
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14)
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
    const token = await this.accessToken()

    const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.max(1, Math.round(amountCents / 100)),
        PartyA: phoneNumber.replace(/^(\+?254)/, '254'),
        PartyB: shortcode,
        PhoneNumber: phoneNumber.replace(/^(\+?254)/, '254'),
        CallBackURL: process.env.MPESA_CALLBACK_URL ?? '',
        AccountReference: reference.slice(0, 12),
        TransactionDesc: 'MOTORA invoice payment',
      }),
    })
    if (!res.ok) {
      throw new ApiError('PAYMENT_PROVIDER_ERROR', `M-Pesa STK push failed (${res.status}).`, 502)
    }
    const body = (await res.json()) as { MerchantRequestID?: string; CheckoutRequestID?: string }
    return {
      simulated: false,
      merchantRequestId: body.MerchantRequestID,
      checkoutRequestId: body.CheckoutRequestID,
    }
  }
}
