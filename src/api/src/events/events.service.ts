import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventBus } from './event-bus.service';
import { EventAccessService } from './event-access.service';
import { LiveHub, type Sink } from './live-hub';
import { TicketStore, type TicketViewer } from './event-tickets';

@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly hub: LiveHub;
  private readonly tickets = new TicketStore();

  constructor(bus: EventBus, access: EventAccessService) {
    this.hub = new LiveHub(bus, access);
  }

  issueTicket(viewer: TicketViewer) {
    return this.tickets.issue(viewer);
  }
  redeem(ticket: string | undefined) {
    return this.tickets.redeem(ticket);
  }
  connect(viewer: TicketViewer, sink: Sink) {
    return this.hub.connect(viewer, sink);
  }
  onModuleDestroy() {
    this.hub.shutdown();
  }
}
