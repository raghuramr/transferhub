import { Controller, Get, Query, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { StudentJourneyService } from './student-journey.service';

@Controller('student')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('student', 'faculty', 'admin', 'super_admin') // staff only with ?userId= (scope rules apply); agencies excluded
export class StudentJourneyController {
  constructor(private service: StudentJourneyService) {}

  /** "Where I am now": current institution, program, courses, credits, target. */
  @Get('overview')
  async overview(@Req() req: AuthenticatedRequest, @Query('userId', new ParseUUIDPipe({ optional: true })) userId?: string) {
    return this.service.overview(await this.service.resolveStudent(req.user, userId));
  }

  /** Active receiving universities for the Explore dropdowns. */
  @Get('universities')
  universities() {
    return this.service.universities();
  }

  /** Side-by-side preview for up to 3 universities: GET /student/compare?ids=1,2,3 */
  @Get('compare')
  async compare(@Req() req: AuthenticatedRequest, @Query('ids') ids: string, @Query('userId', new ParseUUIDPipe({ optional: true })) userId?: string) {
    const parsed = this.service.parseIds(ids);
    return this.service.compare(await this.service.resolveStudent(req.user, userId), parsed);
  }
}
