import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module';
import { ActivityController, AttachmentsController, ConversationsController, MessagesController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [PresenceModule],
  controllers: [ConversationsController, MessagesController, AttachmentsController, ActivityController],
  providers: [ChatService],
})
export class ChatModule {}
