import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SaveAiSettingsDto {
  /** null/omitted = the global row; a number = that university's override. */
  @IsOptional() @IsInt() institutionId?: number | null;
  @IsOptional() @IsBoolean() isEnabled?: boolean;
  @IsOptional() @IsBoolean() autoRunOnIntake?: boolean;
  @IsOptional() @IsString() @MaxLength(100) matchModel?: string;
  @IsOptional() @IsString() @MaxLength(100) escalationModel?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1) escalateBelowConfidence?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) autoLikelyThreshold?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) prefilterTopN?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) maxDescriptionChars?: number;
  @IsOptional() @IsBoolean() useTopics?: boolean;
  @IsOptional() @IsBoolean() useResultCache?: boolean;
  @IsOptional() @IsBoolean() usePromptCaching?: boolean;
  @IsOptional() @IsInt() @Min(50) @Max(8000) maxOutputTokens?: number;
  @IsOptional() @IsInt() @Min(0) maxTokensPerRequest?: number | null;
  @IsOptional() @IsInt() @Min(0) monthlyTokenBudget?: number | null;
  @IsOptional() @IsBoolean() narrativeBriefEnabled?: boolean;
}

export class SaveSkillDto {
  @IsOptional() @IsString() @MaxLength(60) skillKey?: string;
  @IsString() @MaxLength(150) title: string;
  @IsIn(['matching', 'policy', 'token_saving', 'documents']) category: string;
  @IsString() @MaxLength(2000) instructions: string;
  @IsBoolean() isActive: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
