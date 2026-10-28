import { Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private events: EventsService) {}

  /** Authenticated: returns a ~30 s single-use ticket for GET /events/stream. */
  @Post('ticket')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  ticket(@Req() req: AuthenticatedRequest) {
    return this.events.issueTicket({ id: req.user.id, role: req.user.role });
  }

  /** Server-Sent Events. Auth is the ticket (EventSource cannot set headers); it is burned on use. */
  @Get('stream')
  stream(@Query('ticket') ticket: string | undefined, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const viewer = this.events.redeem(ticket);
    if (!viewer) {
      res.status(401).json({ message: 'Invalid or expired ticket' });
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const conn = this.events.connect(viewer, {
      write: (c) => {
        const ok = res.write(c);
        (res as unknown as { flush?: () => void }).flush?.();
        return ok;
      },
      end: () => res.end(),
    });
    if (!conn) {
      res.write('event: error\ndata: {"message":"Too many open live connections"}\n\n');
      res.end();
      return;
    }
    const cleanup = () => conn.close();
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }
}
