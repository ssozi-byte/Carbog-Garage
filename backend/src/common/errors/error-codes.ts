/**
 * Stable, user-safe error codes (Spec §31/§49). Never expose stack traces,
 * SQL, or internals — the exception filter maps everything through here.
 */
export const ErrorCodes = {
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',

  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  MFA_ALREADY_ENROLLED: 'MFA_ALREADY_ENROLLED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  PHONE_TAKEN: 'PHONE_TAKEN',
  EMAIL_TAKEN: 'EMAIL_TAKEN',

  // OTP phone sign-in (Phase 5C)
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',

  // Bookings
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  BOOKING_WINDOW_CLOSED: 'BOOKING_WINDOW_CLOSED',

  // Work orders (Phase 5A)
  WORK_ORDER_NOT_FOUND: 'WORK_ORDER_NOT_FOUND',

  // Inspections / media (Phase 5B)
  INSPECTION_NOT_FOUND: 'INSPECTION_NOT_FOUND',
  RUN_ALREADY_COMPLETED: 'RUN_ALREADY_COMPLETED',
  ITEM_NOT_IN_TEMPLATE: 'ITEM_NOT_IN_TEMPLATE',
  RESULT_NOT_FOUND: 'RESULT_NOT_FOUND',
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',

  // Estimates & approvals (Phase 5C)
  ESTIMATE_NOT_FOUND: 'ESTIMATE_NOT_FOUND',
  INVALID_ESTIMATE_STATE: 'INVALID_ESTIMATE_STATE',
  ESTIMATE_EMPTY: 'ESTIMATE_EMPTY',

  // Parts & inventory (Phase 5D)
  PART_REQUEST_NOT_FOUND: 'PART_REQUEST_NOT_FOUND',
  INVALID_PART_REQUEST_STATE: 'INVALID_PART_REQUEST_STATE',
  PART_SKU_TAKEN: 'PART_SKU_TAKEN',

  // Quality / invoicing / payments (Phase 5E)
  QC_NOT_FOUND: 'QC_NOT_FOUND',
  QC_ALREADY_DECIDED: 'QC_ALREADY_DECIDED',
  QC_INCOMPLETE: 'QC_INCOMPLETE',
  QC_NOT_APPROVED: 'QC_NOT_APPROVED',
  INVALID_INVOICE_STATE: 'INVALID_INVOICE_STATE',
  INVOICE_EMPTY: 'INVOICE_EMPTY',
  ESTIMATE_NOT_APPROVED: 'ESTIMATE_NOT_APPROVED',
  INVALID_PAYMENT_STATE: 'INVALID_PAYMENT_STATE',
  PAYMENT_PROVIDER_NOT_CONFIGURED: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
  PAYMENT_PROVIDER_ERROR: 'PAYMENT_PROVIDER_ERROR',

  // Vehicles / services
  VEHICLE_NOT_FOUND: 'VEHICLE_NOT_FOUND',
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',

  // Car wash (Phase 6)
  INVALID_WASH_STEP_TRANSITION: 'INVALID_WASH_STEP_TRANSITION',
  WASH_JOB_NOT_FOUND: 'WASH_JOB_NOT_FOUND',
  NOT_A_WASH_JOB: 'NOT_A_WASH_JOB',
  WASH_ALREADY_READY: 'WASH_ALREADY_READY',

  // Comms & reminders (Phase 7)
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  UPDATE_NO_RECIPIENTS: 'UPDATE_NO_RECIPIENTS',
  REMINDER_NOT_FOUND: 'REMINDER_NOT_FOUND',
  REMINDER_ALREADY_SENT: 'REMINDER_ALREADY_SENT',

  // Inventory
  PART_NOT_FOUND: 'PART_NOT_FOUND',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',

  // Billing / payments
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INVOICE_VOID: 'INVOICE_VOID',
  AMOUNT_EXCEEDS_BALANCE: 'AMOUNT_EXCEEDS_BALANCE',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  DUPLICATE_CALLBACK: 'DUPLICATE_CALLBACK',
} as const

export type ErrorCode = keyof typeof ErrorCodes

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static notFound(code: ErrorCode, message: string): ApiError {
    return new ApiError(code, message, 404)
  }
  static forbidden(message = 'You do not have access to this resource.'): ApiError {
    return new ApiError('FORBIDDEN', message, 403)
  }
  static unauthorized(message = 'Authentication required.'): ApiError {
    return new ApiError('UNAUTHORIZED', message, 401)
  }
  static validation(message: string, details?: unknown): ApiError {
    return new ApiError('VALIDATION_ERROR', message, 400, details)
  }
  static conflict(code: ErrorCode, message: string): ApiError {
    return new ApiError(code, message, 409)
  }
}
