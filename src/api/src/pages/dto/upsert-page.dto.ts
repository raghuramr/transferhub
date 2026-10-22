import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpsertPageDto {
  @IsString()
  @MaxLength(150)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated',
  })
  slug: string;

  @IsString()
  @MaxLength(200)
  title: string;

  // Validated structurally in PagesService (discriminated by `type`);
  // class-validator only checks it's an array here.
  @IsArray()
  blocks: Record<string, any>[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsBoolean()
  showInNav?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  navLabel?: string;

  @IsOptional()
  @IsInt()
  navOrder?: number;
}
