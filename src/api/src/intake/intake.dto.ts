import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LookupDto {
  @IsString() @MinLength(3) @MaxLength(100) idNumber: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(20) universityCode?: string;
  @IsOptional() @IsIn(['link', 'qr', 'email']) channel?: 'link' | 'qr' | 'email';
}

export class ClaimDto {
  @IsString() @MinLength(20) token: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
  /** The student must tick the consent box before anything is created. */
  @IsBoolean() @Equals(true, { message: 'You need to confirm the details and give consent to continue.' }) consent: boolean;
  @IsOptional() @IsInt() targetInstitutionId?: number;
  @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @IsOptional() @IsBoolean() submitForEvaluation?: boolean;
}

export class InviteDto {
  @IsInt() sourceProfileId: number;
}
