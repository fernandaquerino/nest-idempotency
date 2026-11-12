import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes returned in the `code` field of error responses.
 * These strings are part of the public API and do not change between minor versions.
 */
export const IdempotencyErrorCode = {
  /** The route requires an `Idempotency-Key` header and none was sent. HTTP 400. */
  KEY_MISSING: 'IDEMPOTENCY_KEY_MISSING',
  /** The `Idempotency-Key` header is not 1–255 visible ASCII characters. HTTP 400. */
  KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  /** A request with the same key is still being processed. HTTP 409, with `Retry-After`. */
  REQUEST_IN_PROGRESS: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  /** The key was already used for a request with a different fingerprint. HTTP 422. */
  KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
} as const;

/** Union of every value in {@link IdempotencyErrorCode}. */
export type IdempotencyErrorCode = (typeof IdempotencyErrorCode)[keyof typeof IdempotencyErrorCode];

const STATUS_BY_CODE: Record<IdempotencyErrorCode, HttpStatus> = {
  IDEMPOTENCY_KEY_MISSING: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_KEY_INVALID: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_REQUEST_IN_PROGRESS: HttpStatus.CONFLICT,
  IDEMPOTENCY_KEY_REUSED: HttpStatus.UNPROCESSABLE_ENTITY,
};

const ERROR_NAME_BY_STATUS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
};

const DEFAULT_MESSAGES: Record<IdempotencyErrorCode, string> = {
  IDEMPOTENCY_KEY_MISSING: 'This endpoint requires an Idempotency-Key header.',
  IDEMPOTENCY_KEY_INVALID: 'The Idempotency-Key header must be 1-255 visible ASCII characters.',
  IDEMPOTENCY_REQUEST_IN_PROGRESS:
    'A request with this Idempotency-Key is still being processed. Retry later.',
  IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used with a different request payload.',
};

/** Shape of the JSON body sent for every idempotency error. */
export interface IdempotencyErrorBody {
  statusCode: number;
  error: string;
  code: IdempotencyErrorCode;
  message: string;
}

/**
 * HTTP exception thrown by the idempotency interceptor. It extends Nest's `HttpException`,
 * so it works with the default and with custom exception filters.
 *
 * The response body is `{ statusCode, error, code, message }`, where `code` is one of
 * {@link IdempotencyErrorCode}.
 */
export class IdempotencyException extends HttpException {
  readonly code: IdempotencyErrorCode;

  constructor(code: IdempotencyErrorCode, message: string = DEFAULT_MESSAGES[code]) {
    const status = STATUS_BY_CODE[code];
    const body: IdempotencyErrorBody = {
      statusCode: status,
      error: ERROR_NAME_BY_STATUS[status] ?? 'Error',
      code,
      message,
    };
    super(body, status);
    this.name = 'IdempotencyException';
    this.code = code;
  }
}

/**
 * Thrown at application startup when `@Idempotent()` is used in a way the module cannot
 * support, such as on a streaming (`StreamableFile` or SSE) route, or when the module
 * options are invalid.
 */
export class IdempotencyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConfigurationError';
  }
}
