import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { TransferPolicyService } from './transfer-policy.service';
import { SavePolicyDto, SaveExamRuleDto } from './policy.dto';
import { ExamCreditService } from './exam-credit.service';

/** Transfer-credit rules (minimum grade, credit caps, course age, P/F, accreditation, Hub) per university. */
@Controller('policies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PolicyController {
  constructor(private policies: TransferPolicyService, private exams: ExamCreditService) {}

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

  // ── exam credit thresholds (AP / IB / CLEP / A-level) ──

  @Get('exam-rules')
  @Permission('workflows', 'view')
  examRules(@Query('institutionId') institutionId?: string) {
    return this.exams.listRules(institutionId ? Number(institutionId) : null);
  }

  @Put('exam-rules')
  @Permission('workflows', 'edit')
  async saveExamRule(@Body() dto: SaveExamRuleDto) {
    if (!this.exams.validMin(dto.examType, dto.minScore)) {
      throw new BadRequestException(`"${dto.minScore}" is not a valid ${dto.examType} score (AP 1-5, IB 1-7, CLEP 20-80, A-level A*-E).`);
    }
    if (!(await this.exams.ready())) throw new BadRequestException('Exam credit rules need migration 028 to be applied first.');
    return this.exams.saveRule({ ...dto, institutionId: dto.institutionId ?? null, subjectPattern: dto.subjectPattern ?? null, creditsAwarded: dto.creditsAwarded ?? null });
  }

  @Delete('exam-rules/:id')
  @Permission('workflows', 'edit')
  async removeExamRule(@Param('id', ParseIntPipe) id: number) {
    await this.exams.removeRule(id);
    return { message: 'Rule removed.' };
  }
}
