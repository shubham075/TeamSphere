import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CallsModule } from '../calls/calls.module';
import { ChatModule } from '../chat/chat.module';
import { TeamsModule } from '../teams/teams.module';
import { MeetingsController } from './meetings.controller';
import { MeetingPollsService } from './meeting-polls.service';
import { MeetingsService } from './meetings.service';
import { RecordingsService } from './recordings.service';
import { WhiteboardService } from './whiteboard.service';

@Module({
  imports: [AuthModule, CallsModule, ChatModule, TeamsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, RecordingsService, MeetingPollsService, WhiteboardService],
})
export class MeetingsModule {}
