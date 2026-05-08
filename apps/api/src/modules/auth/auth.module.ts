import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';
import { GoogleAuthGuard } from './google-auth.guard';
import { EncryptionModule } from '../../common/encryption/encryption.module';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get('JWT_ACCESS_EXPIRY', '15m') },
      }),
      inject: [ConfigService],
    }),
    EncryptionModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleAuthGuard,
    {
      provide: GoogleStrategy,
      useFactory: (config: ConfigService) => {
        const isConfigured = Boolean(
          config.get<string>('GOOGLE_CLIENT_ID') &&
          config.get<string>('GOOGLE_CLIENT_SECRET') &&
          config.get<string>('GOOGLE_CALLBACK_URL'),
        );

        return isConfigured ? new GoogleStrategy(config) : null;
      },
      inject: [ConfigService],
    },
    AuditService,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
