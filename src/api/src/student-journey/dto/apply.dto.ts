import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

/** Student applies (creates a tracked request) to one or more universities at once. */
export class ApplyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  institutionIds: number[];
}
