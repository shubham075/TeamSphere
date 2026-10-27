import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EntraService } from './entra.service';
import { LdapService } from './ldap.service';
import { SessionService } from './session.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: env.JWT_ACCESS_TTL as `${number}m` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, LdapService, EntraService],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
