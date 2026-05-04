import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

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
    profile: { id: string; emails: Array<{ value: string }>; displayName: string; photos: Array<{ value: string }> },
    done: VerifyCallback,
  ): Promise<void> {
    const user = {
      id: profile.id,
      email: profile.emails[0].value,
      displayName: profile.displayName,
      picture: profile.photos?.[0]?.value,
    };
    done(null, user);
  }
}
