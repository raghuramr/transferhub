import { BadRequestException, Controller, Delete, Get, Ip, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { PURGE_ENTITIES, PurgeEntity, PurgeService } from './purge.service';

/**
 * Permanent delete of universities, programs, courses and topics. Super admin ONLY, by design (not part of
 * the Roles & Permissions matrix). Always preview with GET .../impact first; the DELETE re-checks the same rules.
 */
@Controller('purge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class PurgeController {
  constructor(private purge: PurgeService) {}

  private entity(e: string): PurgeEntity {
    if (!PURGE_ENTITIES.includes(e as PurgeEntity)) throw new BadRequestException(`entity must be one of: ${PURGE_ENTITIES.join(', ')}`);
    return e as PurgeEntity;
  }

  /** What would be deleted, kept-but-unlinked, and what blocks the delete. Changes nothing. */
  @Get(':entity/:id/impact')
  impact(@Param('entity') entity: string, @Param('id', ParseIntPipe) id: number, @Query('cascade') cascade?: string) {
    return this.purge.impact(this.entity(entity), id, cascade === '1' || cascade === 'true');
  }

  @Delete(':entity/:id')
  remove(
    @Param('entity') entity: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('cascade') cascade: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.purge.remove(this.entity(entity), id, cascade === '1' || cascade === 'true', req.user, ip);
  }
}
