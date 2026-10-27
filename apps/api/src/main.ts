import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap() {
  // Local development reads apps/api/.env; production passes real environment variables.
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env file */
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const env = app.get<Env>(ENV);

  // Behind the Next.js proxy (dev) or the reverse proxy (prod); needed for correct client IPs.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  console.log(`TeamSphere API listening on http://localhost:${env.PORT}/api`);
}

bootstrap();
