import {
  Controller, Post, Get, Body, Query, Req, UseGuards, HttpCode, HttpStatus, ParseIntPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './authenticated-request.interface';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { RegisterStudentDto } from './dto/register-student.dto';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}

class RefreshDto {
  @IsString() refreshToken: string;
}

class LogoutDto {
  @IsOptional() @IsString() refreshToken?: string;
}

class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /** Public — no auth. Student self-registration; auto-logs in on success. */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterStudentDto, @Req() req: Request) {
    const ip = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.register(dto, ip, userAgent);
  }

  /** Public — no auth. Registration-page dropdown data. */
  @Get('universities')
  publicUniversities() {
    return this.authService.publicUniversities();
  }

  /** Public — no auth. Extra registration questions managed under SuperAdmin > Custom Forms. */
  @Get('registration-form')
  publicRegistrationForm() {
    return this.authService.publicRegistrationForm();
  }

  /** Public — no auth. A university's schools/colleges (transfer applicants must pick one). */
  @Get('academic-units')
  publicAcademicUnits(@Query('institutionId', ParseIntPipe) institutionId: number) {
    return this.authService.publicAcademicUnits(institutionId);
  }

  /** Public — no auth. Registration-page dropdown data. */
  @Get('programs')
  publicPrograms(@Query('institutionId', ParseIntPipe) institutionId: number) {
    return this.authService.publicPrograms(institutionId);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
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
  async logout(@Body() dto: LogoutDto, @Req() req: AuthenticatedRequest) {
    await this.authService.logout(req.user.id, dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    return this.authService.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthenticatedRequest) {
    await this.authService.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
    return { message: 'Password changed successfully' };
  }
}
