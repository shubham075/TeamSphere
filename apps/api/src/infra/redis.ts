import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  }

  async onModuleDestroy() {
    await this.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
