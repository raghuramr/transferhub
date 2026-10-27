import { Body, Controller, Delete, Get, Ip, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { EmailService } from './email.service';
import { EmailOverridesService } from './email-overrides.service';
import { type TemplateOverride } from './email-templates';

class OverrideDto implements TemplateOverride {
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(200) headline?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(1200, { each: true }) paragraphs?: string[];
  @IsOptional() @IsString() @MaxLength(60) ctaLabel?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true }) cc?: string[];
}

class DraftDto {
  @IsOptional() @ValidateNested() @Type(() => OverrideDto) draft?: OverrideDto;
  @IsOptional() @IsEmail() to?: string;
}

/** Super admin only: edit the wording, on/off state and CC recipients of each e-mail template. */
@Controller('email/overrides')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class EmailTemplatesController {
  constructor(private email: EmailService, private overrides: EmailOverridesService) {}

  private known(key: string) {
    const item = this.email.catalogue().find((c) => c.key === key);
    if (!item) throw new NotFoundException('No such template');
    return item;
  }

  /** Every template with its coded text, placeholders, and the stored override (if any). */
  @Get()
  async list() {
    const ready = await this.overrides.ready();
    const stored = ready ? await this.overrides.loadAll() : new Map<string, TemplateOverride>();
    return {
      ready,
      items: this.email.catalogue().map((c) => ({ ...c, override: stored.get(c.key) ?? null })),
    };
  }

  @Put(':key')
  async save(@Param('key') key: string, @Body() dto: OverrideDto, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    this.known(key);
    return { override: await this.overrides.save(key, dto, req.user, ip) };
  }

  /** Reset to the coded default. */
  @Delete(':key')
  async reset(@Param('key') key: string, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    this.known(key);
    await this.overrides.remove(key, req.user, ip);
    return { override: null };
  }

  /** Live preview of an unsaved draft (sample data). */
  @Post(':key/preview')
  preview(@Param('key') key: string, @Body() dto: DraftDto) {
    this.known(key);
    const e = this.email.previewDraft(key, dto.draft ?? null);
    if (!e) throw new NotFoundException('No such template');
    return { subject: e.subject, html: e.html };
  }

  /** Sends the unsaved draft (sample data) to the caller or `to`. */
  @Post(':key/test')
  async test(@Param('key') key: string, @Body() dto: DraftDto, @Req() req: AuthenticatedRequest) {
    this.known(key);
    const to = dto.to || req.user.email;
    const r = await this.email.sendDraftTest(key, to, dto.draft ?? null);
    if (!r) throw new NotFoundException('No such template');
    return { to, ...r };
  }
}
