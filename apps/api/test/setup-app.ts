import { INestApplication, ValidationPipe, VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

/**
 * Boot the full Nest application for integration/E2E tests, mirroring the
 * production bootstrap (URI versioning + the same ValidationPipe + exception
 * filter) so route resolution and DTO whitelisting behave identically.
 * Requires a reachable Postgres (DATABASE_URL) and Redis (REDIS_URL).
 */
export async function bootTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
