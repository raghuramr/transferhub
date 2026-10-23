import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class UpdateInstitutionDto {
  @IsOptional() @IsNumber() universityId?: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
}
