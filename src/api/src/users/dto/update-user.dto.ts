import { IsString, IsOptional, IsBoolean, IsEmail, IsIn, IsInt, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsIn(['student', 'faculty', 'admin', 'agency', 'super_admin']) role?: string;
  @IsOptional() @IsInt() departmentId?: number;
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() agencyName?: string;
  @IsOptional() @IsInt() agencyId?: number;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() countryOfOrigin?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
