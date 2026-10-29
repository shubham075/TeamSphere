import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RedisModule } from './infra/redis';
import { StorageModule } from './infra/storage';
import { RealtimeCoreModule } from './realtime/realtime.service';
import { PresenceModule } from './presence/presence.module';
import { ChatModule } from './chat/chat.module';
import { CallsModule } from './calls/calls.module';
import { TeamsModule } from './teams/teams.module';
import { FilesModule } from './files/files.module';
import { AccessTokenGuard, RolesGuard } from './common/guards';
import { Public } from './common/auth.decorators';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuditModule,
    RedisModule,
    StorageModule,
    RealtimeCoreModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    AuthModule,
    PresenceModule,
    UsersModule,
    ChatModule,
    CallsModule,
    TeamsModule,
    FilesModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
