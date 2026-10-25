import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // Captured before NestFactory.create(AppModule) touches process.env at all.
  // HTTP_PLATFORM_PORT is the variable IIS's httpPlatformHandler natively
  // guarantees on every spawned process on Windows Azure App Service — no
  // web.config <environmentVariables> mapping required, unlike our prior
  // PORT alias, which kept failing to propagate for reasons that didn't
  // repro consistently. Reading the platform's own variable directly removes
  // that indirection; PORT is kept only as a non-Azure/local-dev fallback.
  const injectedPort = process.env.HTTP_PLATFORM_PORT || process.env.PORT;
  console.log(
    `[bootstrap] HTTP_PLATFORM_PORT=${process.env.HTTP_PLATFORM_PORT ?? '(unset)'} PORT=${process.env.PORT ?? '(unset)'}`,
  );

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());
  // Partner data submissions can carry thousands of rows; Express' 100kb default would reject them.
  app.useBodyParser('json', { limit: '6mb' });

  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const port = Number(injectedPort) || config.get<number>('PORT', 3001);
  await app.listen(port);
  console.log(`University Manager API running on http://localhost:${port}/api`);
}

bootstrap();
