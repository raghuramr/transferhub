import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEquivalencyDto {
  /** The course being transferred in (any university). */
  @IsInt() externalCourseId: number;
  /** The receiving university's course it maps to. */
  @IsInt() buCourseId: number;
  @IsIn(['equivalent', 'elective', 'no_credit', 'bu_only']) outcome: string;
  @IsOptional() @IsNumber() @Min(0) buCredits?: number;
  @IsOptional() @IsString() @MaxLength(40) matchLevel?: string;
  @IsOptional() @IsString() rationale?: string;
  /** Courses taken on/after this date (YYYY-MM-DD). Empty = no start limit. */
  @IsOptional() @Matches(DATE, { message: 'effectiveFrom must be YYYY-MM-DD' }) effectiveFrom?: string;
  /** Courses taken on/before this date (YYYY-MM-DD). Empty = no end limit. */
  @IsOptional() @Matches(DATE, { message: 'effectiveTo must be YYYY-MM-DD' }) effectiveTo?: string;
}

export class UpdateEquivalencyDto {
  @IsOptional() @IsIn(['equivalent', 'elective', 'no_credit', 'bu_only']) outcome?: string;
  @IsOptional() @IsNumber() @Min(0) buCredits?: number | null;
  @IsOptional() @IsString() @MaxLength(40) matchLevel?: string | null;
  @IsOptional() @IsString() rationale?: string | null;
  /** null/'' clears the date. */
  @IsOptional() effectiveFrom?: string | null;
  @IsOptional() effectiveTo?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
