import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module';
import {
  ActivityController, AttachmentsController, ConversationsController, MessagesController, SavedController,
  ScheduledController, SectionsController,
} from './chat.controller';
import { ChatScheduler } from './chat.scheduler';
import { ChatService } from './chat.service';
import { LinkPreviewService } from './link-preview.service';

@Module({
  imports: [PresenceModule],
  controllers: [
    ConversationsController, MessagesController, AttachmentsController, ActivityController, SavedController,
    SectionsController, ScheduledController,
  ],
  providers: [ChatService, LinkPreviewService, ChatScheduler],
})
export class ChatModule {}
