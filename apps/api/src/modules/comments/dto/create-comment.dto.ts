import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { CommentType } from '@prisma/client';

export class CreateCommentDto {
  @IsOptional() @IsString() @IsNotEmpty()
  unitId?: string;

  @IsOptional() @IsString() @IsNotEmpty()
  projectId?: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  content!: string;

  @IsOptional() @IsEnum(CommentType)
  commentType?: CommentType;
}

export class UpdateCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(2000)
  content!: string;
}
