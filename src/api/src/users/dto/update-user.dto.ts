import { IsString, IsOptional, IsBoolean, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsString() agencyName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
