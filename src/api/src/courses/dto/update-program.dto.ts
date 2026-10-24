import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class UpdateProgramDto {
  @IsOptional() @IsNumber() institutionId?: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() area?: string;
  @IsOptional() @IsString() degree?: string;
  @IsOptional() @IsString() school?: string;
  @IsOptional() @IsString() keyRules?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() matchStrength?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
