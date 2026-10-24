import { IsEmail, IsString, IsOptional, MinLength, IsInt, IsNumber, Min, Max, Length } from 'class-validator';

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
  @IsOptional() @IsString() postalCode?: string;
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
}
