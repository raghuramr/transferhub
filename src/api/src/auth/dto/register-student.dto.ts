import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

/** One institution the student attended (BU asks for every one - doc 12, BU-AD-03). */
export class EducationEntryDto {
  @IsString() @MaxLength(200) institutionName: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) stateRegion?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsBoolean() isOutsideUS?: boolean;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) fromYear?: number;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) toYear?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(400) creditsEarned?: number;
  @IsOptional() @IsBoolean() fullTime?: boolean;
}

/** AP / IB / A-level exam (counts toward the external-credit cap - BU-CR-05). */
export class ExamEntryDto {
  @IsIn(['AP', 'IB', 'A-level']) examType: string;
  @IsString() @MaxLength(150) subject: string;
  @IsOptional() @IsString() @MaxLength(10) score?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) examYear?: number;
}

/** Public student self-registration — see AuthController.register / migration 012. */
export class RegisterStudentDto {
  // ── Account ──────────────────────────────────────────────────
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() firstName: string;
  @IsString() lastName: string;

  // ── Communications ───────────────────────────────────────────
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;

  // ── Location ─────────────────────────────────────────────────
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() countryOfOrigin?: string;

  // ── Education ────────────────────────────────────────────────
  @IsOptional() @IsString() priorInstitutionName?: string;
  @IsOptional() @IsString() highestEducationLevel?: string;
  @IsOptional() @IsString() fieldOfStudy?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(4.33) gpa?: number;
  @IsOptional() @IsInt() graduationYear?: number;

  // ── Target University / Program (informational — see migration 012) ──
  @IsOptional() @IsInt() targetInstitutionId?: number;
  @IsOptional() @IsInt() targetProgramId?: number;

  // ── Application (BU policy alignment - migration 015) ───────
  @IsOptional() @IsIn(['transfer_applicant', 'admitted_transfer', 'current_student', 'dual_enrollment']) applicantType?: string;
  /** BU school/college (an AcademicUnit of the target university). Transfers cannot apply undeclared. */
  @IsOptional() @IsInt() intendedAcademicUnitId?: number;
  @IsOptional() @IsIn(['fall', 'spring', 'summer']) entryTerm?: string;
  @IsOptional() @IsInt() @Min(2000) @Max(2100) entryYear?: number;
  /** The student's ID at the target university (BU calls it a BUID). Format is validated by the UI per university. */
  @IsOptional() @IsString() @MaxLength(50) buid?: string;
  @IsOptional() @IsBoolean() isNativeEnglish?: boolean;
  @IsOptional() @IsIn(['TOEFL', 'IELTS', 'Duolingo']) englishTestType?: string;
  @IsOptional() @IsString() @MaxLength(20) englishTestScore?: string;
  @IsOptional() @IsBoolean() hasIntlCoursework?: boolean;
  @IsOptional() @IsString() @MaxLength(200) highSchoolName?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) highSchoolGradYear?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(400) creditsCompleted?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => EducationEntryDto) education?: EducationEntryDto[];
  /** Answers to the super-admin-managed "student-registration" custom form, keyed by field key. */
  @IsOptional() @IsObject() extraAnswers?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ExamEntryDto) exams?: ExamEntryDto[];
}
