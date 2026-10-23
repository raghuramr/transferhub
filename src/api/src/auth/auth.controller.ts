import {
  Controller, Post, Get, Body, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IsEmail, IsString, MinLength } from 'class-validator';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}

class RefreshDto {
  @IsString() refreshToken: string;
}

class LogoutDto {
  @IsString() refreshToken: string;
}

class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const ip = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const user = await this.authService.validateUser(dto.email, dto.password, ip, userAgent);
    return this.authService.login(user, ip, userAgent);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto, @Req() req: any) {
    await this.authService.logout(req.user.id, dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    return this.authService.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    await this.authService.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
    return { message: 'Password changed successfully' };
  }
}
