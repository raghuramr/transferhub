import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventBus } from './event-bus.service';
import { EventAccessService } from './event-access.service';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

/** Live updates: in-process EventBus (global, inject it anywhere) + Server-Sent Events stream. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [EventBus, EventAccessService, EventsService],
  controllers: [EventsController],
  exports: [EventBus],
})
export class EventsModule {}
