import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RULE_TYPES } from './programme-rules';

/** Which fields a rule needs depends on its type; ProgrammeRulesService re-checks that with validateRuleInput. */
export class CreateProgramRuleDto {
  @IsInt() institutionId: number;
  /** null/omitted = every programme of the university. */
  @IsOptional() @IsInt() programId?: number | null;
  @IsOptional() @IsString() @MaxLength(20) ruleCode?: string | null;
  @IsIn([...RULE_TYPES]) ruleType: string;
  @IsOptional() @IsInt() @Min(0) @Max(900) levelMin?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(200) maxCount?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(200) minCount?: number | null;
  @IsOptional() @IsString() @MaxLength(200) courseCodePattern?: string | null;
  @IsOptional() @IsString() @MaxLength(100) substituteFor?: string | null;
  @IsOptional() @IsObject() params?: Record<string, unknown> | null;
  @IsString() @MaxLength(500) description: string;
}

export class UpdateProgramRuleDto {
  @IsOptional() @IsInt() institutionId?: number;
  @IsOptional() @IsInt() programId?: number | null;
  @IsOptional() @IsString() @MaxLength(20) ruleCode?: string | null;
  @IsOptional() @IsIn([...RULE_TYPES]) ruleType?: string;
  @IsOptional() @IsInt() @Min(0) @Max(900) levelMin?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(200) maxCount?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(200) minCount?: number | null;
  @IsOptional() @IsString() @MaxLength(200) courseCodePattern?: string | null;
  @IsOptional() @IsString() @MaxLength(100) substituteFor?: string | null;
  @IsOptional() @IsObject() params?: Record<string, unknown> | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
