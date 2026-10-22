import { IsEmail, IsString, IsIn, IsOptional, MinLength, IsInt } from 'class-validator';

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() firstName: string;
  @IsString() lastName: string;
  @IsIn(['student', 'faculty', 'admin', 'agency', 'super_admin']) role: string;
  @IsOptional() @IsInt() departmentId?: number;
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() agencyName?: string;
}
