import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  Optional,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defer, lastValueFrom, type Observable, throwError } from 'rxjs';
import {
  IDEMPOTENCY_RESOLVED_OPTIONS,
  IDEMPOTENT_METADATA,
  IDEMPOTENT_REPLAYED_HEADER,
  REPLAYED_HEADERS,
} from './constants';
import {
  IdempotencyConfigurationError,
  IdempotencyErrorCode,
  IdempotencyException,
} from './errors';
import { computeFingerprint } from './fingerprint';
import { IDEMPOTENCY_KEY_HEADER, parseIdempotencyKeyHeader } from './key';
import type { IdempotentOptions } from './idempotent.decorator';
import type { IdempotencyRequest, ResolvedIdempotencyOptions } from './options';
import type { StoredBody, StoredResponse } from './storage/storage.interface';

/** The parts of an Express response the interceptor uses. */
interface HttpResponse {
  statusCode: number;
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  getHeaders(): Record<string, number | string | string[] | undefined>;
}

interface Settings {
  required: boolean;
  ttlMs: number;
  lockTimeoutMs: number;
  cacheClientErrors: boolean;
}

/**
 * Applied by `@Idempotent()`. Not exported: use the decorator.
 * @internal
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotency');
  private readonly options: ResolvedIdempotencyOptions;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(IDEMPOTENCY_RESOLVED_OPTIONS) options?: ResolvedIdempotencyOptions,
  ) {
    if (!options) {
      throw new IdempotencyConfigurationError(
        '@Idempotent() is used but IdempotencyModule is not configured. ' +
          'Import IdempotencyModule.forRoot() or IdempotencyModule.forRootAsync() in your root module.',
      );
    }
    this.options = options;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = this.reflector.get<IdempotentOptions | undefined>(
      IDEMPOTENT_METADATA,
      context.getHandler(),
    );
    if (!route || context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<IdempotencyRequest>();
    const res = http.getResponse<HttpResponse>();
    const settings = this.settings(route);

    const parsed = parseIdempotencyKeyHeader(req.headers[IDEMPOTENCY_KEY_HEADER]);
    if (parsed.status === 'missing') {
      if (!settings.required) return next.handle();
      return throwError(() => new IdempotencyException(IdempotencyErrorCode.KEY_MISSING));
    }
    if (parsed.status === 'invalid') {
      return throwError(() => new IdempotencyException(IdempotencyErrorCode.KEY_INVALID));
    }

    return defer(() => this.process(context, next, req, res, parsed.key, settings));
  }

  private async process(
    context: ExecutionContext,
    next: CallHandler,
    req: IdempotencyRequest,
    res: HttpResponse,
    clientKey: string,
    settings: Settings,
  ): Promise<unknown> {
    const { storage } = this.options;
    const fingerprint = await this.fingerprint(req);
    const key = this.storageKey(context, req, clientKey);

    const acquired = await storage.acquire(key, {
      fingerprint,
      lockTimeoutMs: settings.lockTimeoutMs,
    });

    if (!acquired.acquired) {
      const { record } = acquired;
      if (record.fingerprint !== fingerprint) {
        throw new IdempotencyException(IdempotencyErrorCode.KEY_REUSED);
      }
      if (record.status === 'IN_PROGRESS') {
        res.setHeader('Retry-After', String(this.options.retryAfterSeconds));
        throw new IdempotencyException(IdempotencyErrorCode.REQUEST_IN_PROGRESS);
      }
      res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
      return this.replay(record.response, res);
    }

    const { lockToken } = acquired;
    let value: unknown;
    try {
      value = await lastValueFrom(next.handle(), { defaultValue: undefined });
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      if (isClientError(status) && settings.cacheClientErrors) {
        const response: StoredResponse = {
          statusCode: status,
          headers: pickHeaders(res),
          body: { type: 'exception', value: toJsonValue((error as HttpException).getResponse()) },
        };
        await this.complete(key, fingerprint, lockToken, response, settings);
      } else {
        await this.release(key, lockToken);
      }
      throw error;
    }

    if (value instanceof StreamableFile) {
      await this.release(key, lockToken);
      throw new IdempotencyConfigurationError(
        `@Idempotent() routes cannot return a StreamableFile (${context.getClass().name}.${context.getHandler().name})`,
      );
    }

    const status = res.statusCode;
    if (status >= 500 || (isClientError(status) && !settings.cacheClientErrors)) {
      await this.release(key, lockToken);
      return value;
    }

    const response: StoredResponse = {
      statusCode: status,
      headers: pickHeaders(res),
      body: toStoredBody(value),
    };
    await this.complete(key, fingerprint, lockToken, response, settings);
    // Send exactly what a replay will send, so the first response and retries match.
    return fromStoredBody(response.body);
  }

  private replay(response: StoredResponse, res: HttpResponse): unknown {
    for (const [name, value] of Object.entries(response.headers)) {
      res.setHeader(name, value);
    }
    res.status(response.statusCode);
    if (response.body.type === 'exception') {
      throw new HttpException(
        response.body.value as string | Record<string, unknown>,
        response.statusCode,
      );
    }
    return fromStoredBody(response.body);
  }

  private async complete(
    key: string,
    fingerprint: string,
    lockToken: string,
    response: StoredResponse,
    settings: Settings,
  ): Promise<void> {
    try {
      const stored = await this.options.storage.complete(key, {
        fingerprint,
        lockToken,
        response,
        ttlMs: settings.ttlMs,
      });
      if (!stored) {
        this.logger.warn(
          `Response for idempotency key "${key}" was not stored: the lock expired and another request took the key. ` +
            'Consider raising lockTimeoutSeconds.',
        );
      }
    } catch (error) {
      // The handler already ran, so its response is still sent. The lock is kept: it expires
      // after lockTimeoutSeconds, which blocks immediate duplicate executions meanwhile.
      this.logger.error(`Failed to store the response for idempotency key "${key}"`, error);
    }
  }

  private async release(key: string, lockToken: string): Promise<void> {
    try {
      await this.options.storage.release(key, lockToken);
    } catch (error) {
      this.logger.error(
        `Failed to release the lock for idempotency key "${key}"; it expires after lockTimeoutSeconds`,
        error,
      );
    }
  }

  private settings(route: IdempotentOptions): Settings {
    return {
      required: route.required ?? true,
      ttlMs: (route.ttlSeconds ?? this.options.ttlSeconds) * 1000,
      lockTimeoutMs: (route.lockTimeoutSeconds ?? this.options.lockTimeoutSeconds) * 1000,
      cacheClientErrors: route.cacheClientErrors ?? this.options.cacheClientErrors,
    };
  }

  private async fingerprint(req: IdempotencyRequest): Promise<string> {
    if (this.options.fingerprint) return this.options.fingerprint(req);
    return computeFingerprint({ method: req.method, path: req.path, body: req.body });
  }

  /**
   * `<scope>:<METHOD>:<route>:<client key>`. Every part but the client key is URI-encoded,
   * so no part can contain the `:` separator and different namespaces never collide.
   */
  private storageKey(
    context: ExecutionContext,
    req: IdempotencyRequest,
    clientKey: string,
  ): string {
    const scope = this.options.scope?.(req);
    const routePath =
      typeof req.route?.path === 'string'
        ? req.route.path
        : `${context.getClass().name}.${context.getHandler().name}`;
    return [
      scope === undefined || scope === null ? '' : encodeURIComponent(String(scope)),
      req.method.toUpperCase(),
      encodeURIComponent(routePath),
      clientKey,
    ].join(':');
  }
}

function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

function pickHeaders(res: HttpResponse): Record<string, string> {
  const all = res.getHeaders();
  const picked: Record<string, string> = {};
  for (const name of REPLAYED_HEADERS) {
    const value = all[name];
    if (value === undefined) continue;
    picked[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return picked;
}

function toJsonValue(value: unknown): unknown {
  const json = JSON.stringify(value);
  return json === undefined ? null : JSON.parse(json);
}

function toStoredBody(value: unknown): StoredBody {
  if (value === undefined) return { type: 'empty' };
  if (typeof value === 'string') return { type: 'text', value };
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return { type: 'binary', base64: bytes.toString('base64') };
  }
  return { type: 'json', value: toJsonValue(value) };
}

function fromStoredBody(body: StoredBody): unknown {
  switch (body.type) {
    case 'empty':
      return undefined;
    case 'text':
      return body.value;
    case 'binary':
      return Buffer.from(body.base64, 'base64');
    case 'json':
    case 'exception':
      return body.value;
  }
}
