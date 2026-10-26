import { IsIn, IsArray, IsNotEmpty } from 'class-validator';

export class ImportPayloadDto {
  @IsIn(['universities', 'programs', 'courses', 'students'])
  type: 'universities' | 'programs' | 'courses' | 'students';

  @IsArray()
  @IsNotEmpty()
  data: Record<string, unknown>[];
}
