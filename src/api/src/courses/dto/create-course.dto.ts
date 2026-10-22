import { IsString, IsOptional, IsNumber, IsBoolean, IsIn } from 'class-validator';

export class CreateCourseDto {
  @IsNumber() institutionId: number;
  @IsString() code: string;
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() credits: number;
  @IsOptional() @IsString() creditType?: string;
  @IsOptional() @IsNumber() departmentId?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
