import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // Captured before NestFactory.create(AppModule) runs ConfigModule's .env
  // loading, which can overwrite process.env.PORT in place with whatever a
  // deployed .env file (or Azure Application Setting) defines — that must
  // never beat the real, dynamically-assigned port Azure's httpPlatformHandler
  // injects at the OS env level, or IIS's reverse proxy can never reach the
  // process it just started (healthy boot, permanent 502/503).
  const injectedPort = process.env.PORT;

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

  const port = Number(injectedPort) || config.get<number>('PORT', 3001);
  await app.listen(port);
  console.log(`University Manager API running on http://localhost:${port}/api`);
}

bootstrap();
