import { Module } from '@nestjs/common';
import { FileLibraries } from './file-libraries';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, FileLibraries],
  exports: [FilesService, FileLibraries],
})
export class FilesModule {}
