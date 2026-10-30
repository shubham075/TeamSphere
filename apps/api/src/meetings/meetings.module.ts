import { Module } from '@nestjs/common';
import { CallsModule } from '../calls/calls.module';
import { ChatModule } from '../chat/chat.module';
import { TeamsModule } from '../teams/teams.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [CallsModule, ChatModule, TeamsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
