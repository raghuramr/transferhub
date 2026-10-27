import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class DemoLoginDto {
  @IsBoolean() enabled: boolean;
  /** role -> userId map of the accounts to offer on the login page. */
  @IsOptional() @IsObject() users?: Record<string, string>;
}

export class DemoLoginAsDto {
  @IsString() userId: string;
}
