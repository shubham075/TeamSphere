import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PlannerModule } from '../planner/planner.module';
import { FormsService } from './forms.service';
import { FormsController, ListsController } from './lists.controller';
import { ListsService } from './lists.service';
import { Ownership } from './ownership';

@Module({
  imports: [FilesModule, PlannerModule],
  controllers: [ListsController, FormsController],
  providers: [Ownership, ListsService, FormsService],
})
export class ListsModule {}
