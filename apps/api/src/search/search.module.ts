import { Controller, Get, Module, Query } from '@nestjs/common';
import { SearchQuery, searchQuerySchema, SearchResults } from '@teamsphere/shared';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FilesModule } from '../files/files.module';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Results page and typeahead (small `limit`). */
  @Get()
  find(@CurrentUser() me: AuthUser, @Query(new ZodPipe(searchQuerySchema)) query: SearchQuery): Promise<SearchResults> {
    return this.search.search(me.id, query);
  }
}

@Module({
  imports: [FilesModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
