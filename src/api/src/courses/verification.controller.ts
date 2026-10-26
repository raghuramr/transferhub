import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { VerificationService } from './verification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

class RaiseDto {
  @IsInt() courseId: number;
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}
class ResolveDto {
  @IsIn(['verified', 'rejected']) status: 'verified' | 'rejected';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

@Controller('verification-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VerificationController {
  constructor(private service: VerificationService) {}

  /** Faculty see their own requests; admins see everyone's. */
  @Get()
  @Roles('faculty', 'admin', 'super_admin')
  list(@Req() req: AuthenticatedRequest, @Query('status') status?: string, @Query('mine') mine?: string) {
    return this.service.list(req.user, { status: status || undefined, mine: mine === 'true' });
  }

  @Post()
  @Roles('faculty', 'admin', 'super_admin')
  raise(@Body() dto: RaiseDto, @Req() req: AuthenticatedRequest) {
    return this.service.raise(req.user.id, dto.courseId, dto.reason);
  }

  @Post(':id/resolve')
  @Roles('admin', 'super_admin')
  resolve(@Param('id', ParseIntPipe) id: number, @Body() dto: ResolveDto, @Req() req: AuthenticatedRequest) {
    return this.service.resolve(id, req.user.id, dto.status, dto.note);
  }
}
