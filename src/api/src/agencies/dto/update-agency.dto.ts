import { MaxLength, IsString, IsOptional, IsBoolean, IsEmail } from 'class-validator';

export class UpdateAgencyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) heroImageUrl?: string;
}
