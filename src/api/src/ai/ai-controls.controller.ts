import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { AiSettingsService, AiSettingsInput } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';
import { SaveAiSettingsDto, SaveSkillDto } from './dto/ai-controls.dto';

/** Everything the "AI Controls" admin page needs: spend switches, the agent playbook, and token accounting. */
@Controller('ai-controls')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiControlsController {
  constructor(
    private settings: AiSettingsService,
    private usage: AiUsageService,
  ) {}

  @Get('settings')
  @Permission('ai_controls', 'view')
  listSettings() {
    return this.settings.list();
  }

  @Put('settings')
  @Permission('ai_controls', 'edit')
  saveSettings(@Body() dto: SaveAiSettingsDto, @Req() req: AuthenticatedRequest) {
    const { institutionId, ...rest } = dto;
    return this.settings.upsert(institutionId ?? null, rest as AiSettingsInput, req.user.id);
  }

  @Delete('settings/:institutionId')
  @Permission('ai_controls', 'edit')
  async removeOverride(@Param('institutionId', ParseIntPipe) institutionId: number) {
    await this.settings.removeOverride(institutionId);
    return { message: 'Override removed; this university now uses the global settings.' };
  }

  @Get('skills')
  @Permission('ai_controls', 'view')
  skills() {
    return this.settings.listSkills();
  }

  @Post('skills')
  @Permission('ai_controls', 'edit')
  createSkill(@Body() dto: SaveSkillDto, @Req() req: AuthenticatedRequest) {
    return this.settings.saveSkill(null, dto, req.user.id);
  }

  @Put('skills/:id')
  @Permission('ai_controls', 'edit')
  updateSkill(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveSkillDto, @Req() req: AuthenticatedRequest) {
    return this.settings.saveSkill(id, dto, req.user.id);
  }

  @Delete('skills/:id')
  @Permission('ai_controls', 'edit')
  async deleteSkill(@Param('id', ParseIntPipe) id: number) {
    await this.settings.removeSkill(id);
    return { message: 'Skill removed' };
  }

  @Get('prompt-preview')
  @Permission('ai_controls', 'view')
  promptPreview() {
    return this.settings.buildSystemPrompt();
  }

  @Get('usage/summary')
  @Permission('ai_controls', 'view')
  async summary(@Query('days') days?: string) {
    const d = Math.min(Math.max(parseInt(days ?? '30', 10) || 30, 1), 365);
    return { ...(await this.usage.summary(d)), cache: await this.usage.cacheStats() };
  }

  @Get('usage/requests')
  @Permission('ai_controls', 'view')
  byRequest(@Query('days') days?: string) {
    const d = Math.min(Math.max(parseInt(days ?? '30', 10) || 30, 1), 365);
    return this.usage.byRequest(d);
  }

  @Post('cache/clear')
  @Permission('ai_controls', 'edit')
  async clearCache() {
    return { cleared: await this.usage.clearMatchCache() };
  }
}
