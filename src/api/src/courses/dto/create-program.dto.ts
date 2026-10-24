import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

// Programs belong to a University (SQL `Institutions` table — see
// CLAUDE.md for the naming inversion vs. UI "Institutions"/AcademicUnits).
export class CreateProgramDto {
  @IsNumber() institutionId: number;
  @IsString() name: string;
  @IsOptional() @IsString() area?: string;
  @IsOptional() @IsString() degree?: string;
  @IsOptional() @IsString() school?: string;
  @IsOptional() @IsString() keyRules?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() matchStrength?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
