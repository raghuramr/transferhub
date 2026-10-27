import { IsIn, IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';

const PARTIES = ['student', 'source_university', 'target_university'];

export class CreateDocumentRequestDto {
  /** Which side is being asked. */
  @IsIn(PARTIES) fromParty: string;
  /** Which side the caller speaks for (needed only when the account may speak for both universities). */
  @IsOptional() @IsIn(PARTIES) party?: string;
  @IsOptional() @IsString() @MaxLength(40) docTypeKey?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) message?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
}

export class ResolveDocumentRequestDto {
  @IsOptional() @IsIn(PARTIES) party?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Multipart text fields that accompany the file. */
export class UploadForTransferDto {
  @IsOptional() @IsIn(PARTIES) party?: string;
  @IsOptional() @IsString() @MaxLength(40) documentType?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() @MaxLength(12) documentRequestId?: string;
}

export class PartyReminderDto {
  @IsIn(PARTIES) toParty: string;
  @IsOptional() @IsIn(PARTIES) party?: string;
  @IsOptional() @IsString() @MaxLength(12) documentRequestId?: string;
  @IsOptional() @IsString() @MinLength(0) @MaxLength(500) message?: string;
}
