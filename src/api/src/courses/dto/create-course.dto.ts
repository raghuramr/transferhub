import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateCourseDto {
  @IsNumber() institutionId: number;
  @IsString() code: string;
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() credits: number;
  @IsOptional() @IsNumber() programId?: number;
  @IsOptional() @IsString() programArea?: string;
  @IsOptional() @IsString() requirementType?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
