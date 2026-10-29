import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module';
import { ChannelPostsService } from './channel-posts.service';
import { ChannelsController, TagsController, TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [PresenceModule],
  controllers: [TeamsController, ChannelsController, TagsController],
  providers: [TeamsService, ChannelPostsService],
})
export class TeamsModule {}
