import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EmailService } from './email.service';

class TestEmailDto {
  @IsOptional()
  @IsEmail()
  to?: string;
}

/** Lets a super admin see how email is configured and prove delivery with a test message. */
@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class EmailController {
  constructor(private email: EmailService) {}

  @Get('status')
  status() {
    return this.email.status();
  }

  @Post('test')
  async test(@Body() dto: TestEmailDto, @Req() req: { user: { email: string } }) {
    const to = dto.to || req.user.email;
    const result = await this.email.sendTest(to);
    return { to, ...result };
  }
}
