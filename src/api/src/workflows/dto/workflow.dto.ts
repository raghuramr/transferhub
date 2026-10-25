import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class ApproverDto {
  @IsIn(['role', 'group', 'user']) approverType: 'role' | 'group' | 'user';
  @IsOptional() @IsIn(['faculty', 'admin', 'super_admin']) roleName?: string;
  @IsOptional() @IsInt() groupId?: number;
  @IsOptional() @IsUUID() userId?: string;
}

export class StageDto {
  @IsOptional() @IsInt() id?: number;
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsIn(['system', 'review', 'approval']) stageType: 'system' | 'review' | 'approval';
  @IsIn(['none', 'intake', 'match', 'finalize']) agentTask: 'none' | 'intake' | 'match' | 'finalize';
  @IsOptional() @IsInt() @Min(1) @Max(365) slaDays?: number | null;
  @IsBoolean() isEnabled: boolean;
  @IsBoolean() canBypass: boolean;
  @IsBoolean() requiresComment: boolean;
  /** The agent approves this stage by itself when every course is matched with enough confidence and nothing is flagged. */
  @IsOptional() @IsBoolean() autoApprove?: boolean;
  @IsOptional() @IsNumber() @Min(0.5) @Max(1) autoApproveMinConfidence?: number | null;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ApproverDto) approvers: ApproverDto[];
}

export class RequiredDocDto {
  @IsString() @MaxLength(40) docTypeKey: string;
  @IsBoolean() isRequired: boolean;
}

export class SaveWorkflowDto {
  @IsString() @MaxLength(150) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsBoolean() allowBypass: boolean;
  @IsBoolean() isActive: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => StageDto) stages: StageDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RequiredDocDto) requiredDocs?: RequiredDocDto[];
}

export class CreateWorkflowDto {
  /** The intaking university this workflow is for. */
  @IsInt() institutionId: number;
  @IsString() @MaxLength(150) name: string;
  /** Start from a copy of an existing workflow (default: the global one). */
  @IsOptional() @IsInt() copyFromWorkflowId?: number;
}

export class SaveGroupDto {
  @IsString() @MaxLength(150) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() institutionId?: number | null;
  @IsBoolean() isActive: boolean;
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) memberUserIds: string[];
}
