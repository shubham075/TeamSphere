import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ChannelTabsService } from './channel-tabs.service';
import { ChannelTabsController, PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

@Module({
  imports: [FilesModule],
  controllers: [PlannerController, ChannelTabsController],
  providers: [PlannerService, ChannelTabsService],
  exports: [ChannelTabsService],
})
export class PlannerModule {}
