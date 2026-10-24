import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

// Named "Institutions" in the UI/API routes; backed by the `AcademicUnits`
// SQL table (a school/college within a University). See CLAUDE.md /
// migration 008 for the naming rationale.
export class CreateInstitutionDto {
  // Nullable/optional: an Institution may exist unmapped to any University
  // until an admin assigns one (see migration 016).
  @IsOptional() @IsNumber() universityId?: number | null;
  @IsString() name: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
}
