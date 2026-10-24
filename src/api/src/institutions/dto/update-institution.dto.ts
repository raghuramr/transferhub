import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class UpdateInstitutionDto {
  // Explicit null clears the University mapping (see migration 016).
  @IsOptional() @IsNumber() universityId?: number | null;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
}
