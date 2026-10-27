import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

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
