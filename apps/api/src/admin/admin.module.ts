import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TeamsModule } from '../teams/teams.module';
import { AdminController, OrgController } from './admin.controller';
import { AdminService } from './admin.service';
import { OrgService } from './org.service';
import { PolicyService } from './policy.service';

/** Global so feature services can enforce policies and org limits without importing this module. */
@Global()
@Module({
  imports: [AuthModule, TeamsModule],
  controllers: [AdminController, OrgController],
  providers: [AdminService, OrgService, PolicyService],
  exports: [OrgService, PolicyService],
})
export class AdminModule {}
