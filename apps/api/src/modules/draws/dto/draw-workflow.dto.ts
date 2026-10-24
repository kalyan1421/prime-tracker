import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DrawDocType } from '@prisma/client';
import { IsStorageKey } from '../../../common/storage/storage-key';

/**
 * Bodies for the draw workflow. Every transition and document route took an inline
 * `@Body()` type, which the global ValidationPipe skips. The sharpest consequence was on
 * attachDocument: the body was spread straight into `drawDocument.create`, so any extra
 * key — `uploadedById`, `id`, `drawRequestId` — was written as sent, overriding the
 * values the controller set, and `storagePath` went to the signer unchecked.
 */
export class DrawCommentDto {
  @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;
}

export class MarkDrawFundedDto {
  @IsOptional() @IsDateString()
  fundedAt?: string;
}

export class RejectDrawDto {
  @IsString() @IsNotEmpty() @MaxLength(2000)
  reason!: string;
}

export class AttachDrawDocumentDto {
  @IsEnum(DrawDocType)
  documentType!: DrawDocType;

  @IsString() @IsStorageKey()
  storagePath!: string;

  @IsString() @IsNotEmpty() @MaxLength(255)
  filename!: string;
}

export class RenameDrawDocumentDto {
  @IsString() @IsNotEmpty() @MaxLength(255)
  filename!: string;
}
