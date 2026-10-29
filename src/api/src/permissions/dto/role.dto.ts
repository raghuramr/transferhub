import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const BASE_ROLES = ['student', 'faculty', 'admin', 'agency'] as const;

export class CreateRoleDto {
  /** Short key, lower case letters / digits / underscore (max 20), e.g. "registrar". */
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,19}$/, { message: 'The key must be 2-20 characters: lower case letters, digits or underscore, starting with a letter.' }) name: string;
  @IsString() @MinLength(2) @MaxLength(100) displayName: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  /** The built-in role whose screens and fixed access rules this role follows. */
  @IsIn(BASE_ROLES as unknown as string[]) baseRole: string;
  /** Start with a copy of another role's grants (defaults to the base role). */
  @IsOptional() @IsInt() copyFromRoleId?: number;
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
