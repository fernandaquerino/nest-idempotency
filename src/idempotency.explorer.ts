import { Inject, Injectable, type OnModuleInit, StreamableFile } from '@nestjs/common';
import { DiscoveryService, HttpAdapterHost } from '@nestjs/core';
import {
  IDEMPOTENT_METADATA,
  NEST_METADATA,
  ROUTE_PARAM_NEXT,
  ROUTE_PARAM_RESPONSE,
} from './constants';
import { IdempotencyConfigurationError } from './errors';

/**
 * Checks every `@Idempotent()` route at startup and fails fast on routes whose response the
 * interceptor cannot capture and replay.
 * @internal
 */
@Injectable()
export class IdempotencyExplorer implements OnModuleInit {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    const problems: string[] = [];
    let decoratedRoutes = 0;

    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
      if (!controller?.prototype) continue;

      for (const name of methodNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        if (!Reflect.getMetadata(IDEMPOTENT_METADATA, handler)) continue;
        decoratedRoutes++;
        for (const problem of checkRoute(controller, name, handler)) {
          problems.push(`${controller.name}.${name}: ${problem}`);
        }
      }
    }

    const adapter = this.adapterHost?.httpAdapter;
    const type = adapter?.getType?.();
    if (decoratedRoutes > 0 && type !== undefined && type !== 'express') {
      problems.push(
        `the "${type}" HTTP adapter is not supported yet; nest-idempotency supports @nestjs/platform-express`,
      );
    }

    if (problems.length > 0) {
      throw new IdempotencyConfigurationError(
        `@Idempotent() cannot be used on these routes:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      );
    }
  }
}

function checkRoute(controller: object, name: string, handler: object): string[] {
  const problems: string[] = [];

  if (Reflect.getMetadata(NEST_METADATA.sse, handler)) {
    problems.push('server-sent events (@Sse()) are streamed and cannot be stored or replayed');
  }
  if (
    Reflect.getMetadata(
      'design:returntype',
      (controller as { prototype: object }).prototype,
      name,
    ) === StreamableFile
  ) {
    problems.push('StreamableFile responses are streamed and cannot be stored or replayed');
  }
  if (Reflect.getMetadata(NEST_METADATA.render, handler) !== undefined) {
    problems.push('@Render() responses cannot be stored or replayed');
  }
  if (Reflect.getMetadata(NEST_METADATA.redirect, handler) !== undefined) {
    problems.push('@Redirect() responses cannot be stored or replayed');
  }

  const args = (Reflect.getMetadata(NEST_METADATA.routeArguments, controller, name) ??
    {}) as Record<string, unknown>;
  const types = Object.keys(args).map((key) => Number(key.split(':')[0]));
  const passthrough = Reflect.getMetadata(NEST_METADATA.responsePassthrough, controller, name);
  if ((types.includes(ROUTE_PARAM_RESPONSE) || types.includes(ROUTE_PARAM_NEXT)) && !passthrough) {
    problems.push(
      'handlers that send the response themselves (@Res() or @Next()) cannot be replayed; ' +
        'return the body instead, or use @Res({ passthrough: true })',
    );
  }
  return problems;
}

function methodNames(prototype: object): string[] {
  const names = new Set<string>();
  let current: object | null = prototype;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor && typeof descriptor.value === 'function') names.add(name);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...names];
}
