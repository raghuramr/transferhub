import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());

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

  // process.env.PORT (not ConfigService) is the source of truth for the actual
  // listen port: on Windows Azure App Service, httpPlatformHandler injects the
  // real, dynamically-assigned port via PORT at the OS env level, which must
  // win over any PORT a deployed .env file or Azure Application Setting
  // happens to also define — otherwise the app binds to the wrong port and
  // IIS's reverse proxy can never reach it (healthy boot, permanent 502/503).
  const port = Number(process.env.PORT) || config.get<number>('PORT', 3001);
  await app.listen(port);
  console.log(`University Manager API running on http://localhost:${port}/api`);
}

bootstrap();
