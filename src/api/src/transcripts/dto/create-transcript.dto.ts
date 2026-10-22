import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class TranscriptCourseInputDto {
  @IsString() courseCode: string;
  @IsString() courseTitle: string;
  @IsNumber() originalCredits: number;
  @IsString() grade: string;
  @IsOptional() @IsString() term?: string;
}

/**
 * Matches the single combined payload the Upload Transcript screen sends:
 * institution details + an inline list of courses, submitted in one call.
 */
export class SubmitTranscriptDto {
  @IsString() institutionName: string;
  @IsString() institutionCode: string;
  @IsIn(['semester', 'quarter', 'trimester']) calendar: string;
  @IsOptional() @IsString() studentName?: string;
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptCourseInputDto)
  courses: TranscriptCourseInputDto[];
}
