import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module';
import { CallsController, VoicemailsController } from './calls.controller';
import { CallsService } from './calls.service';
import { LivekitService } from './livekit.service';

@Module({
  imports: [PresenceModule],
  controllers: [CallsController, VoicemailsController],
  providers: [CallsService, LivekitService],
  exports: [LivekitService],
})
export class CallsModule {}
