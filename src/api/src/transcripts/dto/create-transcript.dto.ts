import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsIn, IsInt, IsBoolean, IsUUID, Matches, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class TranscriptCourseInputDto {
  @IsString() courseCode: string;
  @IsString() courseTitle: string;
  @IsNumber() originalCredits: number;
  @IsString() grade: string;
  @IsOptional() @IsString() term?: string;
  // BU policy inputs (doc 12): age check, P/F rule, no credit for experience, online limits, intl coursework.
  @IsOptional() @IsIn(['fall', 'spring', 'summer', 'winter', 'other']) termSeason?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) termYear?: number;
  @IsOptional() @IsIn(['graded', 'pass_fail', 'sat_unsat']) gradingBasis?: string;
  @IsOptional() @IsIn(['in_person', 'online', 'hybrid']) deliveryMode?: string;
  @IsOptional() @IsIn(['lecture', 'lab', 'seminar', 'internship', 'research', 'military', 'life_experience', 'other']) courseType?: string;
  @IsOptional() @IsBoolean() isOutsideUS?: boolean;
  /** Optional per-course syllabus: id of an Upload (entityType 'syllabus') the submitter owns. */
  @IsOptional() @IsUUID() syllabusUploadId?: string;
  /** Optional link to the course's public catalogue / syllabus page (http or https). */
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^https?:\/\/\S+$/i, { message: 'catalogUrl must start with http:// or https://' }) catalogUrl?: string;
}

/** Student edit of one already-submitted course's details; the request is re-triaged after. */
export class UpdateTranscriptCourseDto {
  @IsOptional() @IsString() courseCode?: string;
  @IsOptional() @IsString() courseTitle?: string;
  @IsOptional() @IsNumber() originalCredits?: number;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() term?: string;
  @IsOptional() @IsIn(['fall', 'spring', 'summer', 'winter', 'other']) termSeason?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) termYear?: number;
  @IsOptional() @IsIn(['graded', 'pass_fail', 'sat_unsat']) gradingBasis?: string;
}

/**
 * Matches the single combined payload the Upload Transcript screen sends:
 * institution details + an inline list of courses, submitted in one call.
 */
export class SubmitTranscriptDto {
  @IsString() institutionName: string;
  @IsString() institutionCode: string;
  @IsIn(['semester', 'quarter', 'trimester']) calendar: string;
  /** Where the student wants these credits applied (the receiving university). Falls back to their profile target, else BU. */
  @IsOptional() @IsInt() targetInstitutionId?: number;
  @IsOptional() @IsString() studentName?: string;
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() notes?: string;
  /** Id of an Upload (entityType 'transcript') the student attached — see UploadsService. */
  @IsOptional() @IsString() documentUploadId?: string;
  /** The sending institution is outside the US: every course is routed to International Admissions. */
  @IsOptional() @IsBoolean() isOutsideUS?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptCourseInputDto)
  courses: TranscriptCourseInputDto[];
}
