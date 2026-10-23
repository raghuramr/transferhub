import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, ValidateNested } from 'class-validator';

export class MatrixEntryDto {
  @IsInt()
  roleId!: number;

  @IsInt()
  moduleId!: number;

  @IsInt()
  operationId!: number;

  @IsBoolean()
  isAllowed!: boolean;
}

export class SaveMatrixDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MatrixEntryDto)
  entries!: MatrixEntryDto[];
}
