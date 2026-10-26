import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { TransferPolicyService } from './transfer-policy.service';
import { SavePolicyDto } from './policy.dto';

/** Transfer-credit rules (minimum grade, credit caps, course age, P/F, accreditation, Hub) per university. */
@Controller('policies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PolicyController {
  constructor(private policies: TransferPolicyService) {}

  /** The signed-in student's external-credit position and Hub obligation. */
  @Get('my-credit')
  myCredit(@Req() req: AuthenticatedRequest) {
    return this.policies.creditSummary(req.user.id);
  }

  @Get()
  @Permission('workflows', 'view')
  list() {
    return this.policies.list();
  }

  @Put()
  @Permission('workflows', 'edit')
  save(@Body() dto: SavePolicyDto, @Req() req: AuthenticatedRequest) {
    const { institutionId, ...rest } = dto;
    return this.policies.upsert(institutionId ?? null, rest, req.user.id);
  }

  @Delete(':institutionId')
  @Permission('workflows', 'edit')
  async remove(@Param('institutionId', ParseIntPipe) institutionId: number) {
    await this.policies.removeOverride(institutionId);
    return { message: 'Override removed; this university now follows the global rules.' };
  }
}
