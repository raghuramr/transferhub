import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

export const SWAGGER_PATH = 'api/docs';

/** On in development; in production only when SWAGGER_ENABLED=true (it lists every endpoint). */
export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SWAGGER_ENABLED === 'true') return true;
  if (env.SWAGGER_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'production';
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Optional HTTP basic auth in front of the docs: set SWAGGER_USER and SWAGGER_PASSWORD. */
export function swaggerBasicAuth(env: NodeJS.ProcessEnv = process.env) {
  const user = env.SWAGGER_USER;
  const pass = env.SWAGGER_PASSWORD;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!user || !pass) return next();
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const [u, ...rest] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
      if (safeEqual(u ?? '', user) && safeEqual(rest.join(':'), pass)) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="TransferHub API docs"');
    res.status(401).send('Authentication required');
  };
}

const DESCRIPTION = [
  'REST API of TransferHub (BU Transfer Credit Evaluation).',
  '',
  '**How to authorise**',
  '1. Call `POST /api/auth/login` with `{ "email": "...", "password": "..." }` (try it out below).',
  '2. Copy `accessToken` from the response.',
  '3. Click **Authorize** (top right), paste the token (without the word "Bearer") and press Authorize.',
  '',
  'Tokens expire; log in again to get a new one (or use `POST /api/auth/refresh`).',
  'Endpoints are grouped by the first path segment. Request bodies are documented in `docs/` and the DTOs in `src/api/src`.',
].join('\n');

/** Mounts Swagger UI at /api/docs (JSON at /api/docs-json). Call AFTER app.setGlobalPrefix('api'). */
export function setupSwagger(app: NestExpressApplication): void {
  app.use(`/${SWAGGER_PATH}`, swaggerBasicAuth());
  app.use(`/${SWAGGER_PATH}-json`, swaggerBasicAuth());

  const config = new DocumentBuilder()
    .setTitle('TransferHub API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'accessToken from POST /api/auth/login' }, 'bearer')
    .addSecurityRequirements('bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // No @ApiTags anywhere: group every operation by its first path segment after /api/.
  for (const [path, item] of Object.entries(document.paths)) {
    const tag = path.split('/').filter(Boolean)[1] ?? 'root';
    for (const op of Object.values(item as Record<string, { tags?: string[] }>)) {
      if (op && typeof op === 'object') op.tags = [tag];
    }
  }

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha', operationsSorter: 'alpha' },
    customSiteTitle: 'TransferHub API',
  });
}
