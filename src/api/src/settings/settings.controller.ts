import { Body, Controller, ForbiddenException, Get, Ip, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from './settings.service';
import { DemoLoginAsDto, DemoLoginDto } from './settings.dto';

/** Public, no login: what the login page may show, and the one-click demo sign-in. */
@Controller('auth')
export class DemoLoginPublicController {
  constructor(private settings: SettingsService, private auth: AuthService) {}

  @Get('demo-login')
  async demoLogin(@Ip() ip: string) {
    return this.settings.publicDemoLogin(ip);
  }

  /**
   * One-click demo sign-in. Only works while demo login is on AND the id is one of the offered
   * accounts (chosen by a super admin). Issues a normal session for that user — no password crosses
   * the wire, so this exposes nothing a super admin did not deliberately turn on.
   */
  @Post('demo-login')
  async demoLoginAs(@Body() dto: DemoLoginAsDto, @Ip() ip: string, @Req() req: Request) {
    if (!dto?.userId || !(await this.settings.isDemoLoginAllowed(dto.userId, ip))) {
      throw new ForbiddenException('Demo login is not available.');
    }
    const userAgent = (req.headers['user-agent'] as string) ?? '';
    return this.auth.demoLoginAs(dto.userId, ip, userAgent);
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
    return this.settings.getDemoLoginAdmin();
  }

  @Put('demo-login')
  async put(@Body() dto: DemoLoginDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.settings.saveDemoLogin({ enabled: dto.enabled, users: dto.users ?? {} }, req.user, ip);
  }
}
