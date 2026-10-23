import { IsString, IsOptional, IsInt, IsArray, ValidateNested, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';

export class ReferenceLinkDto {
  @IsString() label: string;
  @IsUrl({ require_protocol: true }) url: string;
}

export class CreateCourseTopicDto {
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceLinkDto)
  referenceLinks?: ReferenceLinkDto[];
}

export class UpdateCourseTopicDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceLinkDto)
  referenceLinks?: ReferenceLinkDto[];
}
