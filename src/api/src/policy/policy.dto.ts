import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SavePolicyDto {
  /** null/omitted = the global default; a number = that university's override. */
  @IsOptional() @IsInt() institutionId?: number | null;
  @IsOptional() @IsIn(['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-']) minGrade?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxCourseAgeYears?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(200) capTransfer?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(200) capFirstYear?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(200) capCurrentStudent?: number;
  @IsOptional() @IsBoolean() allowPassFail?: boolean;
  @IsOptional() @IsBoolean() requireAccreditation?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(40) hubRequirementsTransfer?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) hubCocurricularAllowed?: number;
  /** PRG-02: months from starting within which all credit must be transferred. */
  @IsOptional() @IsInt() @Min(1) @Max(120) creditDeadlineMonths?: number;
}

export class SaveExamRuleDto {
  @IsOptional() @IsInt() id?: number;
  /** null/omitted = global default rule. */
  @IsOptional() @IsInt() institutionId?: number | null;
  @IsIn(['AP', 'IB', 'A-level', 'CLEP']) examType!: 'AP' | 'IB' | 'A-level' | 'CLEP';
  @IsOptional() @IsString() @MaxLength(150) subjectPattern?: string | null;
  @IsString() @MaxLength(10) minScore!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(60) creditsAwarded?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}
