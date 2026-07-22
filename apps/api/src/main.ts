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
