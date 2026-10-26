import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Query, UseGuards } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { ClaimDto, InviteDto, LookupDto } from './intake.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

/** Public, no login: a student asks for their record, previews it from an emailed link, then confirms. */
@Controller('intake')
export class IntakeController {
  constructor(private intake: IntakeService) {}

  @Post('lookup')
  @HttpCode(200)
  lookup(@Body() dto: LookupDto, @Ip() ip: string) {
    return this.intake.lookup(dto, ip);
  }

  @Get('session')
  session(@Query('token') token: string) {
    return this.intake.getSession(token);
  }

  @Post('claim')
  @HttpCode(200)
  claim(@Body() dto: ClaimDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.intake.claim(dto, ip, userAgent ?? '');
  }
}

/** Staff view: the shareable link, demo records, recent activity. */
@Controller('intake/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class IntakeAdminController {
  constructor(private intake: IntakeService) {}

  @Get('overview')
  overview() {
    return this.intake.adminOverview();
  }

  @Post('invite')
  @HttpCode(200)
  invite(@Body() dto: InviteDto) {
    return this.intake.sendInvite(dto.sourceProfileId, 'email');
  }
}
