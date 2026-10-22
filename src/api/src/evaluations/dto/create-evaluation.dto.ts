import { IsNumber, IsString, IsOptional, IsIn } from 'class-validator';

export class CreateEvaluationDto {
  @IsNumber() transcriptCourseId: number;
  @IsNumber() recommendedBuCourseId: number;
  @IsIn(['equivalent', 'elective', 'no_credit', 'bu_only']) outcome: string;
  @IsOptional() @IsString() rationale?: string;
  @IsOptional() @IsNumber() creditsGranted?: number;
}
