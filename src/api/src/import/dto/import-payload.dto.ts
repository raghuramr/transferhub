import { IsIn, IsArray, IsNotEmpty } from 'class-validator';

export class ImportPayloadDto {
  @IsIn(['universities', 'programs', 'courses'])
  type: 'universities' | 'programs' | 'courses';

  @IsArray()
  @IsNotEmpty()
  data: Record<string, unknown>[];
}
