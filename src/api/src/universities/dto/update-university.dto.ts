import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator';

export class UpdateUniversityDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(['semester', 'quarter']) calendar?: string;
  @IsOptional() @IsIn(['university', 'community_college']) type?: string;
  @IsOptional() @IsBoolean() isBU?: boolean;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
