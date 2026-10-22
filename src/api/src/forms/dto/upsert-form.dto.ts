import { IsString, IsOptional, IsIn, IsObject, MaxLength, Matches } from 'class-validator';

export class UpsertFormDto {
  @IsString()
  @MaxLength(150)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated',
  })
  slug: string;

  @IsString() @MaxLength(200)
  title: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsIn(['draft', 'open', 'closed'])
  status?: string;

  // { fields: FormField[] } — validated structurally in FormsService.
  @IsObject()
  schema: { fields: Record<string, any>[] };

  @IsOptional() @IsString()
  successMessage?: string;
}

export class SubmitFormDto {
  @IsObject()
  data: Record<string, any>;
}

export class DecideSubmissionDto {
  @IsIn(['reviewed', 'approved', 'rejected'])
  status: string;

  @IsOptional() @IsString()
  adminNotes?: string;
}
