import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Step 1 of BU's Transfer Credit Appeal Form (one course per appeal). */
export class CreateAppealDto {
  @IsOptional() @IsInt() proposedBUCourseId?: number;
  @IsOptional() @IsString() @MaxLength(200) proposedEquivalent?: string;
  /** "Reason for re-evaluation (MUST provide answer)". */
  @IsString() @MinLength(20) @MaxLength(4000) reason: string;
  /** The external course's syllabus (an Upload the student owns). */
  @IsOptional() @IsUUID() syllabusUploadId?: string;
}

/** Step 2: the department's decision. */
export class DecideAppealDto {
  @IsIn(['equivalent', 'elective', 'no_credit', 'denied']) outcome: 'equivalent' | 'elective' | 'no_credit' | 'denied';
  @IsOptional() @IsInt() buCourseId?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(30) awardedCredits?: number;
  @IsOptional() @IsString() @MaxLength(300) satisfiesRequirement?: string;
  @IsOptional() @IsString() @MaxLength(1000) denialReason?: string;
  @IsString() @MinLength(2) @MaxLength(150) departmentName: string;
  @IsOptional() @IsString() @MaxLength(4000) comments?: string;
  /** Typed name standing in for the department signature. */
  @IsString() @MinLength(2) @MaxLength(150) signedName: string;
}
