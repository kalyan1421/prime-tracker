import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { GoogleProfile } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: {
      id: string;
      emails?: Array<{ value: string; verified?: boolean | string }>;
      displayName: string;
      photos?: Array<{ value: string }>;
    },
    done: VerifyCallback,
  ): Promise<void> {
    const primary = profile.emails?.[0];
    const user: GoogleProfile = {
      id: profile.id,
      email: primary?.value ?? '',
      // passport-google-oauth20 copies the OpenID `email_verified` claim here. It is a
      // boolean from the v3 userinfo endpoint, but older endpoints sent the string 'true',
      // so accept both and treat anything else — including absent — as unverified.
      // AuthService refuses unverified addresses.
      emailVerified: primary?.verified === true || primary?.verified === 'true',
      displayName: profile.displayName,
      picture: profile.photos?.[0]?.value,
    };
    done(null, user);
  }
}
