import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { PlannerModule } from '../planner/planner.module';
import { BoardsService } from './boards.service';
import { BoardsController, PagesController } from './collab.controller';
import { CollabService } from './collab.service';
import { PagesService } from './pages.service';

@Module({
  imports: [FilesModule, MeetingsModule, PlannerModule],
  controllers: [PagesController, BoardsController],
  providers: [CollabService, PagesService, BoardsService],
})
export class CollabModule {}
