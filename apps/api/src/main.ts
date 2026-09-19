import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { JsonLogger } from './common/logging/json.logger';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';

async function bootstrap() {
  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // The app is created FIRST so that ConfigService is the single source of truth for
  // "are we in production?".
  //
  // This block used to read `process.env.NODE_ENV` directly, and nothing populated it:
  // deploy.sh writes NODE_ENV into apps/api/.env and then starts the process with
  // `pm2 start dist/main.js`, which does not source that file. ConfigModule reads it, but
  // only once NestFactory.create() has run — which was AFTER these decisions. So on the
  // live box `process.env.NODE_ENV` was undefined while `config.get('NODE_ENV')` returned
  // 'production', and the two reads of the same variable disagreed: the DEMO_MODE guard
  // below could not fire, JsonLogger was never installed, and listen() bound 0.0.0.0
  // instead of 127.0.0.1. The Swagger and dev-user guards further down used config.get()
  // and behaved correctly, which is what made the split so easy to miss.
  //
  // Nothing is served until app.listen() at the bottom, so every check here still runs
  // before the first request and the DEMO_MODE guard still fails closed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffered until useLogger() below, so boot-time messages are not lost.
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const isProd = config.get('NODE_ENV') === 'production';

  // Structured JSON logs in production (CloudWatch-queryable); pretty logs in dev.
  app.useLogger(isProd ? new JsonLogger() : ['error', 'warn', 'log', 'debug']);

  // ---- Refuse to run an auth bypass in production ----
  //
  // DEMO_MODE makes JwtAuthGuard accept `Bearer demo-<ROLE>` with no credential of any
  // kind (see common/guards/jwt-auth.guard.ts). That is exactly what makes local
  // development and the Dev Quick Login pleasant, and exactly what must never reach a
  // real deployment: anyone who guessed the header would be SUPER_ADMIN.
  //
  // A crash is deliberate. The alternative — logging a warning and carrying on, or
  // relying on someone remembering to unset the variable before deploying — fails
  // open, and the whole point is that this one has to fail closed. If the AWS box
  // ever boots with DEMO_MODE=true it will not serve traffic, and the reason will be
  // the first thing in the logs.
  //
  // Read through ConfigService for the same reason as NODE_ENV above: the variable may
  // arrive from the .env file rather than the process environment.
  if (isProd && config.get('DEMO_MODE') === 'true') {
    // eslint-disable-next-line no-console
    console.error(
      '\n=========================================================================\n' +
      'FATAL: DEMO_MODE=true with NODE_ENV=production.\n\n' +
      'DEMO_MODE disables authentication — any request sending\n' +
      '  Authorization: Bearer demo-SUPER_ADMIN\n' +
      'would be granted full administrative access without a password.\n\n' +
      'Remove DEMO_MODE from the production environment and restart.\n' +
      '=========================================================================\n',
    );
    process.exit(1);
  }

  const port = Number(config.get('PORT') ?? config.get('API_PORT', 3001));
  const frontendUrl = config.get('FRONTEND_URL', 'http://localhost:5173');

  // Behind nginx (single reverse proxy), trust the first hop so req.ip resolves to the
  // real client from X-Forwarded-For instead of 127.0.0.1 — without this, ThrottlerGuard
  // buckets every request under the proxy IP and per-IP rate limiting is a no-op.
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet());

  // CORS - locked to frontend origin
  app.enableCors({
    origin: config.get('CORS_ORIGINS', frontendUrl).split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // WebSocket adapter (Socket.IO)
  app.useWebSocketAdapter(new IoAdapter(app));

  // NO static mount for `uploads/`.
  //
  // There used to be an `app.useStaticAssets(uploads, { prefix: '/uploads' })` here. Static
  // assets are not affected by setGlobalPrefix below and carry no guard — the only global
  // guard is ThrottlerGuard — so every task attachment was downloadable by anyone holding
  // the URL, with no token: contracts, lien waivers, site documents. It was also never
  // routed in front of the app (nginx proxies only /api/ and /socket.io/; Vite's dev proxy
  // only /api), so /uploads/... fell through to the SPA's index.html and the Download
  // button saved an HTML page. Both problems had the same cause and the same fix:
  // GET /api/tasks/attachments/:attachmentId/download streams these files behind
  // JwtAuthGuard + PermissionsGuard + ProjectAccessGuard.
  //
  // Anything new that needs to serve a file must go through a guarded controller route
  // (or S3 + a signed URL, as every other upload in the app already does).

  // Global prefix
  app.setGlobalPrefix('api');

  // A file over a FileInterceptor's fileSize limit throws before any controller or DTO
  // runs, so this has to be a global filter, not a per-route try/catch.
  app.useGlobalFilters(new MulterExceptionFilter());

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger (dev only)
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Prime Tracker API')
      .setDescription('Internal Real Estate Development Dashboard')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Ensure dev user exists so JWT bypass FK constraint works
  if (!isProd) {
    const prisma = app.get(PrismaService);
    await prisma.user.upsert({
      where: { id: 'dev-user-1' },
      update: {},
      create: { id: 'dev-user-1', email: 'admin@theprimedeveloper.com', name: 'Admin', role: 'FOUNDER' },
    });
  }

  await app.listen(port, isProd ? '127.0.0.1' : '0.0.0.0');
  console.log(`🚀 Prime Tracker API running on http://localhost:${port}`);
  console.log(`📚 Swagger: http://localhost:${port}/api/docs`);
}

bootstrap();
