import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator';

export class CreateUniversityDto {
  @IsString() code: string;
  @IsString() name: string;
  @IsOptional() @IsIn(['semester', 'quarter']) calendar?: string;
  @IsOptional() @IsIn(['university', 'community_college']) type?: string;
  @IsOptional() @IsBoolean() isBU?: boolean;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
}
