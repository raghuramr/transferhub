import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';

export class CreateTranscriptDto {
  @IsOptional() @IsString() studentUserId?: string;
  @IsNumber() institutionId: number;
  @IsOptional() @IsString() programName?: string;
  @IsOptional() @IsString() termRange?: string;
  @IsOptional() @IsString() notes?: string;
}

export class AddTranscriptCourseDto {
  @IsString() externalCode: string;
  @IsString() externalTitle: string;
  @IsNumber() creditsEarned: number;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsIn(['semester', 'quarter']) creditType?: string;
  @IsOptional() @IsNumber() termYear?: number;
  @IsOptional() @IsString() termSeason?: string;
}
