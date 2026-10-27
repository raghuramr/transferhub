import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsString, IsOptional, IsIn, IsUUID, Min, ValidateNested } from 'class-validator';

/** One BU course an external course counts as (OUT-06). */
export class BuMappingDto {
  @IsInt() buCourseId: number;
  /** Omit to let the system split the converted credits across the courses. */
  @IsOptional() @IsNumber() @Min(0) awardedCredits?: number;
}

export class DecideEvaluationDto {
  @IsIn(['equivalent', 'elective', 'no_credit', 'bu_only']) outcome: string;
  @IsOptional() @IsNumber() buCourseId?: number;
  @IsOptional() @IsNumber() awardedCredits?: number;
  @IsOptional() @IsString() notes?: string;
  /**
   * OUT-06: several BU courses for this one external course, each with its own credits. The first one is the primary
   * course. Single-course decisions keep using buCourseId/awardedCredits unchanged.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BuMappingDto) mappings?: BuMappingDto[];
  /** Shorthand for `mappings` without credits (the converted credits are split across them). */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) buCourseIds?: number[];
}

export class AssignEvaluationDto {
  @IsUUID() userId: string;
}
