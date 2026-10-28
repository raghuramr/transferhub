import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { AiSettingsService, AiSettingsInput } from './ai-settings.service';
import { AiProvidersService, SaveAiProvidersInput, type ChatProvider } from './ai-providers.service';
import { AiService } from './ai.service';
import { BenchmarkService } from './benchmark.service';
import { AiLearningService } from './ai-learning.service';
import { AiUsageService } from './ai-usage.service';
import { ReadinessService } from './readiness.service';
import { BacktestService } from './backtest.service';
import { SaveAiSettingsDto, SaveSkillDto, CustomProviderDto, TestProviderDto, RunBenchmarkDto } from './dto/ai-controls.dto';

/** Everything the "AI Controls" admin page needs: spend switches, the agent playbook, and token accounting. */
@Controller('ai-controls')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiControlsController {
  constructor(
    private settings: AiSettingsService,
    private usage: AiUsageService,
    private readiness: ReadinessService,
    private backtest: BacktestService,
    private providers: AiProvidersService,
    private learning: AiLearningService,
    private ai: AiService,
    private benchmark: BenchmarkService,
  ) {}

  /** Playbook rules suggested by patterns in faculty decisions (nothing is saved until an admin adds one). */
  @Get('learned-skills')
  @Permission('ai_controls', 'view')
  learnedSkills(@Query('min') min?: string) {
    return this.learning.learn(min ? Number(min) : 2);
  }

  /** Weekly accuracy / safety / knowledge-base series for the Learning tab. Read-only, computed on demand. */
  @Get('learning/trend')
  @Permission('ai_controls', 'view')
  learningTrend(@Query('weeks') weeks?: string, @Query('institutionId') institutionId?: string) {
    const inst = institutionId ? Number(institutionId) : null;
    return this.learning.trend(weeks ? Number(weeks) : 26, inst != null && Number.isInteger(inst) ? inst : null);
  }

  /** Headline deltas (now vs 4 weeks ago), what the system learned this month, and recurring mistakes. */
  @Get('learning/overview')
  @Permission('ai_controls', 'view')
  learningOverview(@Query('institutionId') institutionId?: string) {
    const inst = institutionId ? Number(institutionId) : null;
    return this.learning.overview(inst != null && Number.isInteger(inst) ? inst : null);
  }

  /** AI provider configuration (Anthropic + Azure OpenAI/Document Intelligence). Secrets are masked. */
  @Get('providers')
  @Permission('ai_controls', 'view')
  getProviders() {
    return this.providers.getPublic();
  }

  @Put('providers')
  @Permission('ai_controls', 'edit')
  saveProviders(@Body() dto: SaveAiProvidersInput, @Req() req: AuthenticatedRequest) {
    return this.providers.save(dto, req.user.email);
  }

  /** Add an OpenAI-compatible provider (base URL + model + key). */
  @Post('providers/custom')
  @Permission('ai_controls', 'edit')
  addCustomProvider(@Body() dto: CustomProviderDto, @Req() req: AuthenticatedRequest) {
    return this.providers.saveCustom(dto, req.user.email);
  }

  @Put('providers/custom/:id')
  @Permission('ai_controls', 'edit')
  updateCustomProvider(@Param('id') id: string, @Body() dto: CustomProviderDto, @Req() req: AuthenticatedRequest) {
    return this.providers.saveCustom({ ...dto, id }, req.user.email);
  }

  @Delete('providers/custom/:id')
  @Permission('ai_controls', 'edit')
  removeCustomProvider(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.providers.removeCustom(id, req.user.email);
  }

  /** Sends a one-word test prompt through the saved settings of a provider ('anthropic', 'azure_openai' or 'custom:<id>'). */
  @Post('providers/test')
  @Permission('ai_controls', 'edit')
  testProvider(@Body() dto: TestProviderDto) {
    return this.ai.testProvider(dto.provider as ChatProvider);
  }

  /** Engines available to benchmark (Anthropic, Azure OpenAI, custom providers, built-in rules) and which are configured. */
  @Get('benchmark/engines')
  @Permission('ai_controls', 'view')
  benchmarkEngines() {
    return this.benchmark.engines();
  }

  /** Students whose courses go to Boston University and have known answers; `defaults` = the two pre-selected. */
  @Get('benchmark/students')
  @Permission('ai_controls', 'view')
  benchmarkStudents() {
    return this.benchmark.students();
  }

  /** Dry-run the transfer matching for the chosen students through each chosen engine and measure accuracy, speed and cost. */
  @Post('benchmark/run')
  @Permission('ai_controls', 'edit')
  runBenchmark(@Body() dto: RunBenchmarkDto) {
    return this.benchmark.run(dto);
  }

  /** Is the installation ready to run requests end to end? (keys, migrations, approvers, stalled automation) */
  @Get('readiness')
  @Permission('ai_controls', 'view')
  checkReadiness() {
    return this.readiness.check();
  }

  /** Hold-out accuracy of the matcher over past decisions (top-1 / top-3 hit rate). Read-only; cached for 60s. */
  @Get('backtest')
  @Permission('ai_controls', 'view')
  runBacktest(@Query('refresh') refresh?: string) {
    return this.backtest.run(refresh === 'true' || refresh === '1');
  }

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
