import { IsBoolean } from 'class-validator';

export class DemoLoginDto {
  @IsBoolean() enabled: boolean;
  @IsBoolean() showCredentials: boolean;
}
