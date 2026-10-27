import { Controller, Get, Module, Query } from '@nestjs/common';
import type { PresenceInfo } from '@teamsphere/shared';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PresenceService } from './presence.service';

@Controller('presence')
class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /** `GET /presence?ids=a,b,c` (up to 200 users). */
  @Get()
  async get(@Query('ids') ids = ''): Promise<PresenceInfo[]> {
    const list = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    return [...(await this.presence.getMany(list)).values()];
  }
}

@Module({
  controllers: [PresenceController],
  providers: [PresenceService, RealtimeGateway],
  exports: [PresenceService],
})
export class PresenceModule {}
