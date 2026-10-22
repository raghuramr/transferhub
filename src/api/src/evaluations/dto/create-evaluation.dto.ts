import { IsNumber, IsString, IsOptional, IsIn, IsUUID } from 'class-validator';

export class DecideEvaluationDto {
  @IsIn(['equivalent', 'elective', 'no_credit', 'bu_only']) outcome: string;
  @IsOptional() @IsNumber() buCourseId?: number;
  @IsOptional() @IsNumber() awardedCredits?: number;
  @IsOptional() @IsString() notes?: string;
}

export class AssignEvaluationDto {
  @IsUUID() userId: string;
}
