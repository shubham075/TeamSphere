import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule, PresenceModule],
  controllers: [UsersController],
})
export class UsersModule {}
