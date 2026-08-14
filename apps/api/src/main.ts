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

async function bootstrap() {
  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Structured JSON logs in production (CloudWatch-queryable); pretty logs in dev.
  const isProd = process.env.NODE_ENV === 'production';

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
  if (isProd && process.env.DEMO_MODE === 'true') {
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: isProd ? new JsonLogger() : ['error', 'warn', 'log', 'debug'],
  });

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT ?? config.get('API_PORT', 3001));
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

  // Static files for uploaded documents
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Global prefix
  app.setGlobalPrefix('api');

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
  if (config.get('NODE_ENV') !== 'production') {
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
  if (config.get('NODE_ENV') !== 'production') {
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
