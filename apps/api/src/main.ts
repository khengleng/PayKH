import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, VERSION_NEUTRAL, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import express, { Request } from 'express';
import { AppModule } from './app.module';
import { validateConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  const config = validateConfig();
  initSentry(config.sentryDsn, config.nodeEnv, 'api');
  const logger = new Logger('Bootstrap');

  // Disable Nest's default body parser so we can capture the raw body (needed
  // for idempotency hashing and, in Phase 2, inbound webhook signature checks).
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const rawBodySaver = (req: Request, _res: unknown, buf: Buffer) => {
    if (buf?.length) {
      (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    }
  };
  app.use(express.json({ limit: '256kb', verify: rawBodySaver }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // Secure headers.
  app.use(
    helmet({
      contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS: dashboard + checkout front-ends.
  app.enableCors({
    origin: [config.dashboardBaseUrl, config.checkoutBaseUrl],
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  // URI versioning: /v1/... for the public API; other controllers are neutral.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // OpenAPI docs at /docs, JSON at /docs-json.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PayKH API')
    .setDescription('Bakong KHQR payment gateway — REST API (v1)')
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'API key (bk_live_/bk_test_) or dashboard JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });

  await app.listen(config.port, '0.0.0.0');
  logger.log(`PayKH API listening on :${config.port} (provider=${config.paymentProvider})`);
  logger.log(`OpenAPI docs at ${config.appBaseUrl}/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
