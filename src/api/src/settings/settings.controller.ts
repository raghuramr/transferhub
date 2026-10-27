import { Body, Controller, Get, Ip, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { SettingsService } from './settings.service';
import { DemoLoginDto } from './settings.dto';
import { buildPublicDemoLogin } from './demo-login.logic';
import { DEMO_ACCOUNTS } from './demo-accounts';

/** Public, no login: what the login page may show. Disabled -> `{enabled:false}` and nothing else. */
@Controller('auth')
export class DemoLoginPublicController {
  constructor(private settings: SettingsService) {}

  @Get('demo-login')
  async demoLogin(@Ip() ip: string) {
    return this.settings.publicDemoLogin(ip);
  }
}

/** Super admin only. */
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get('demo-login')
  async get() {
    const s = await this.settings.getDemoLogin();
    // `accounts` lets the UI render a live preview even while the public endpoint returns nothing (disabled).
    return { ...s, accounts: DEMO_ACCOUNTS };
  }

  @Put('demo-login')
  async put(@Body() dto: DemoLoginDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    const s = await this.settings.saveDemoLogin(dto, req.user, ip);
    return { ...s, accounts: DEMO_ACCOUNTS };
  }
}
