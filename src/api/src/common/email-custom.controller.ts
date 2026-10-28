import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Post, Put, Req, BadRequestException, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { EmailService } from './email.service';
import { EmailOverridesService } from './email-overrides.service';
import { EmailCustomService } from './email-custom.service';
import { CUSTOM_PLACEHOLDERS, renderCustom, sanitizeCustom, type CustomTemplate } from './email-templates';

class CustomDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(60) audience?: string;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(200) headline?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(1200, { each: true }) paragraphs?: string[];
  @IsOptional() @IsString() @MaxLength(60) ctaLabel?: string;
  @IsOptional() @IsString() @MaxLength(500) ctaUrl?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
class PreviewDto {
  @ValidateNested() @Type(() => CustomDto) draft: CustomDto;
  @IsOptional() @IsObject() vars?: Record<string, string>;
  @IsOptional() @IsEmail() to?: string;
}
class SendDto {
  @IsArray() @ArrayMaxSize(25) @IsEmail({}, { each: true }) to: string[];
  @IsOptional() @IsObject() vars?: Record<string, string>;
}
class BulkDto {
  @IsOptional() @IsArray() @IsString({ each: true }) builtin?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) custom?: string[];
  @IsIn(['activate', 'deactivate', 'delete']) action: 'activate' | 'deactivate' | 'delete';
}

const SAMPLE_VARS = { firstName: 'Alex', lastName: 'Morgan', fullName: 'Alex Morgan', email: 'alex@example.edu', universityName: 'Sample University' };
const cleanVars = (v?: Record<string, string>) => Object.fromEntries(Object.entries(v ?? {}).filter(([k, x]) => CUSTOM_PLACEHOLDERS.includes(k) && typeof x === 'string').map(([k, x]) => [k, x.slice(0, 200)]));

/** Super admin only: create, edit, send, switch on/off and delete custom e-mail templates; bulk actions across built-in + custom. */
@Controller('email/custom')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class EmailCustomController {
  constructor(private email: EmailService, private overrides: EmailOverridesService, private custom: EmailCustomService) {}

  @Get()
  async list() {
    return { ready: await this.custom.ready(), placeholders: CUSTOM_PLACEHOLDERS, items: await this.custom.list() };
  }

  @Post()
  create(@Body() dto: CustomDto, @Req() req: AuthenticatedRequest) {
    return this.custom.create(dto, req.user);
  }

  /** Live preview of an unsaved draft (sample data). Declared before the :id routes. */
  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: PreviewDto) {
    let body;
    try { body = sanitizeCustom({ ...dto.draft, paragraphs: dto.draft?.paragraphs?.length ? dto.draft.paragraphs : ['(Write the body text.)'], subject: dto.draft?.subject || 'Subject', headline: dto.draft?.headline || 'Headline', name: dto.draft?.name || 'Draft' }); }
    catch (e) { throw new BadRequestException((e as Error).message); }
    const e = renderCustom(this.email.context, body, { ...SAMPLE_VARS, ...cleanVars(dto.vars) });
    return { subject: e.subject, html: e.html };
  }

  @Post('bulk')
  @HttpCode(200)
  async bulk(@Body() dto: BulkDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    let done = 0;
    const skipped: { id: string; reason: string }[] = [];
    const catalogue = this.email.catalogue();
    const stored = await this.overrides.loadAll();
    for (const key of dto.builtin ?? []) {
      const item = catalogue.find((c) => c.key === key);
      if (!item) { skipped.push({ id: key, reason: 'Unknown template' }); continue; }
      const cur = stored.get(key) ?? {};
      try {
        if (dto.action === 'delete') {
          if (!stored.has(key)) { skipped.push({ id: item.name, reason: 'Built-in template: nothing to reset (built-ins cannot be deleted)' }); continue; }
          await this.overrides.remove(key, req.user, ip);
        } else if (dto.action === 'deactivate') {
          if (!item.canDisable) { skipped.push({ id: item.name, reason: 'Carries a sign-in or access detail, so it cannot be switched off' }); continue; }
          await this.overrides.save(key, { ...cur, enabled: false }, req.user, ip);
        } else {
          if (cur.enabled !== false) { skipped.push({ id: item.name, reason: 'Already active' }); continue; }
          await this.overrides.save(key, { ...cur, enabled: true }, req.user, ip);
        }
        done++;
      } catch (e) {
        skipped.push({ id: item.name, reason: (e as Error).message });
      }
    }
    for (const id of dto.custom ?? []) {
      try {
        if (dto.action === 'delete') await this.custom.remove(id, req.user);
        else await this.custom.setEnabled(id, dto.action === 'activate', req.user);
        done++;
      } catch (e) {
        skipped.push({ id, reason: (e as Error).message });
      }
    }
    return { done, skipped };
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CustomDto, @Req() req: AuthenticatedRequest) {
    return this.custom.update(id, dto, req.user);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.custom.remove(id, req.user);
    return { ok: true };
  }

  /** Sends a saved, active template to the listed addresses (max 25), with the same placeholder values for each. */
  @Post(':id/send')
  @HttpCode(200)
  async send(@Param('id') id: string, @Body() dto: SendDto) {
    const t = await this.custom.get(id);
    if (!t.enabled) throw new BadRequestException('This template is inactive. Activate it before sending.');
    if (!dto.to?.length) throw new BadRequestException('Add at least one recipient.');
    const results: { to: string; ok: boolean; error?: string }[] = [];
    for (const to of [...new Set(dto.to.map((x) => x.trim().toLowerCase()))]) {
      const e = renderCustom(this.email.context, t, { ...cleanVars(dto.vars), email: to });
      const r = await this.email.send(to, e.subject, e.html, e.text);
      results.push({ to, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
    }
    return { sent: results.filter((r) => r.ok).length, results };
  }

  /** Sends the (unsaved) draft with sample data to the caller or `to`. */
  @Post('test')
  @HttpCode(200)
  async test(@Body() dto: PreviewDto, @Req() req: AuthenticatedRequest) {
    const { subject, html } = this.preview(dto);
    const to = dto.to || req.user.email;
    const r = await this.email.send(to, `[Test] ${subject}`, html);
    return { to, ...r };
  }
}
