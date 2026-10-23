import { IsString, IsOptional, IsBoolean, IsEmail } from 'class-validator';

export class UpdateAgencyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
