import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { IDEMPOTENCY_MODULE_OPTIONS, IDEMPOTENCY_RESOLVED_OPTIONS } from './constants';
import { IdempotencyConfigurationError } from './errors';
import { IdempotencyExplorer } from './idempotency.explorer';
import {
  type IdempotencyModuleAsyncOptions,
  type IdempotencyModuleOptions,
  type IdempotencyOptionsFactory,
  resolveOptions,
} from './options';

const resolvedOptionsProvider: Provider = {
  provide: IDEMPOTENCY_RESOLVED_OPTIONS,
  useFactory: (options: IdempotencyModuleOptions) => resolveOptions(options),
  inject: [IDEMPOTENCY_MODULE_OPTIONS],
};

/**
 * Registers idempotency support for the whole application. Import it once, in the root
 * module; it is global, so `@Idempotent()` works in every module.
 */
@Module({})
export class IdempotencyModule {
  /** Configures the module with static options. */
  static forRoot(options: IdempotencyModuleOptions): DynamicModule {
    // Validate eagerly so misconfiguration fails at the import site.
    resolveOptions(options);
    return this.build([{ provide: IDEMPOTENCY_MODULE_OPTIONS, useValue: options }]);
  }

  /** Configures the module with options resolved from other providers, such as `ConfigService`. */
  static forRootAsync(options: IdempotencyModuleAsyncOptions): DynamicModule {
    return this.build(asyncProviders(options), options.imports ?? []);
  }

  private static build(
    providers: Provider[],
    imports: NonNullable<IdempotencyModuleAsyncOptions['imports']> = [],
  ): DynamicModule {
    return {
      module: IdempotencyModule,
      global: true,
      imports: [DiscoveryModule, ...imports],
      providers: [...providers, resolvedOptionsProvider, IdempotencyExplorer],
      exports: [IDEMPOTENCY_MODULE_OPTIONS, IDEMPOTENCY_RESOLVED_OPTIONS],
    };
  }
}

function asyncProviders(options: IdempotencyModuleAsyncOptions): Provider[] {
  const given = [options.useFactory, options.useClass, options.useExisting].filter(Boolean);
  if (given.length !== 1) {
    throw new IdempotencyConfigurationError(
      'IdempotencyModule.forRootAsync() needs exactly one of useFactory, useClass or useExisting',
    );
  }

  if (options.useFactory) {
    return [
      {
        provide: IDEMPOTENCY_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
    ];
  }

  const factoryToken = options.useClass ?? options.useExisting;
  const providers: Provider[] = [
    {
      provide: IDEMPOTENCY_MODULE_OPTIONS,
      useFactory: (factory: IdempotencyOptionsFactory) => factory.createIdempotencyOptions(),
      inject: [factoryToken as NonNullable<typeof factoryToken>],
    },
  ];
  if (options.useClass) providers.push({ provide: options.useClass, useClass: options.useClass });
  return providers;
}
