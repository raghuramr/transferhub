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
  @IsOptional() @IsBoolean() isActive?: boolean;
}
