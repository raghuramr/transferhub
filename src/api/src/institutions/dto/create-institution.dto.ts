import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

// Named "Institutions" in the UI/API routes; backed by the `AcademicUnits`
// SQL table (a school/college within a University). See CLAUDE.md /
// migration 008 for the naming rationale.
export class CreateInstitutionDto {
  @IsNumber() universityId: number;
  @IsString() name: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
