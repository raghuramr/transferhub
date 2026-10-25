import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, IsInt } from 'class-validator';

export class DecisionDto {
  @IsIn(['approve', 'reject', 'return']) decision: 'approve' | 'reject' | 'return';
  /** Internal comment — visible only to this stage's approvers and admins. */
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
  /** Comment the student can read. */
  @IsOptional() @IsString() @MaxLength(4000) studentComment?: string;
}

export class ReasonDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}

export class NoteDto {
  @IsIn(['internal', 'student']) audience: 'internal' | 'student';
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
  @IsOptional() @IsInt() stageId?: number;
}

export class AddDocumentDto {
  @IsString() @MaxLength(40) docTypeKey: string;
  @IsUUID() uploadId: string;
  @IsOptional() @IsUUID() transcriptCourseId?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class RemindDto {
  @IsOptional() @IsString() @MaxLength(500) message?: string;
}

export class AcceptSuggestionsDto {
  /** 0.5 - 1. Suggestions at or above this confidence become the decision. */
  @IsNumber() @Min(0.5) @Max(1) minConfidence: number;
}

export class BulkApproveDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('all', { each: true }) ids: string[];
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
}
