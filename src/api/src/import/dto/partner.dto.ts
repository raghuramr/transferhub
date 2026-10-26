import { IsArray, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreatePartnerDto {
  @IsString() @IsNotEmpty() @MaxLength(200) universityName: string;
  @IsString() @IsNotEmpty() @MaxLength(20) universityCode: string;
  @IsString() @IsNotEmpty() @MaxLength(150) contactName: string;
  @IsEmail() @MaxLength(256) contactEmail: string;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** Also email the instructions + key to the contact (the key is otherwise shown once on screen). */
  @IsOptional() @IsBoolean() emailKey?: boolean;
}

export class UpdatePartnerDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) universityName?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) universityCode?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(150) contactName?: string;
  @IsOptional() @IsEmail() @MaxLength(256) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class IssueKeyDto {
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsInt() @Min(1) @Max(3650) expiresInDays?: number;
  @IsOptional() @IsBoolean() emailKey?: boolean;
}

export class SubmissionBodyDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsArray() universities?: Record<string, unknown>[];
  @IsOptional() @IsArray() programs?: Record<string, unknown>[];
  @IsOptional() @IsArray() courses?: Record<string, unknown>[];
  @IsOptional() @IsArray() students?: Record<string, unknown>[];
}

export class RowIdsDto {
  @IsArray() @IsInt({ each: true }) rowIds: number[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ImportRowsDto {
  @IsArray() @IsInt({ each: true }) rowIds: number[];
  @IsOptional() @IsBoolean() sendReport?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class EditRowDto {
  @IsObject() payload: Record<string, unknown>;
}

export class RejectBatchDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) note: string;
  @IsOptional() @IsBoolean() sendReport?: boolean;
}

export class SendReportDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
