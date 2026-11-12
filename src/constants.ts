/** Name of the response header added to replayed responses. */
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

/** Injection token for the options passed to `IdempotencyModule.forRoot` or `forRootAsync`. */
export const IDEMPOTENCY_MODULE_OPTIONS = 'IDEMPOTENCY_MODULE_OPTIONS';

/** @internal Injection token for the options after defaults are applied and validated. */
export const IDEMPOTENCY_RESOLVED_OPTIONS = 'IDEMPOTENCY_RESOLVED_OPTIONS';

/** @internal Metadata key set by `@Idempotent()`. */
export const IDEMPOTENT_METADATA = 'nest-idempotency:idempotent';

/**
 * @internal Response headers that are stored and replayed. Everything else (cookies, dates,
 * tracing and rate-limit headers) belongs to one specific response and is not replayed.
 */
export const REPLAYED_HEADERS: readonly string[] = [
  'content-type',
  'content-language',
  'content-location',
  'location',
  'etag',
  'last-modified',
  'link',
];

/**
 * @internal Nest metadata keys read by the startup checks. Copied from `@nestjs/common`
 * because its `constants` module is not exported for ESM consumers; the values are
 * identical in Nest 10 and 11.
 */
export const NEST_METADATA = {
  routeArguments: '__routeArguments__',
  responsePassthrough: '__responsePassthrough__',
  sse: '__sse__',
  render: '__renderTemplate__',
  redirect: '__redirect__',
} as const;

/** @internal Route parameter types from `@nestjs/common` `RouteParamtypes`. */
export const ROUTE_PARAM_RESPONSE = 1;
/** @internal */
export const ROUTE_PARAM_NEXT = 2;
