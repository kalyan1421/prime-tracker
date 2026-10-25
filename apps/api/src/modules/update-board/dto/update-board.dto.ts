import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString, Matches, MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsStorageKey } from '../../../common/storage/storage-key';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * A link on a post. Rendered by the web app as an `href`, so the scheme is checked here:
 * a `javascript:` or `data:` URL stored on a post would run in the session of whoever
 * clicked it. The web form already insists on http(s); this makes the API agree.
 */
export class UpdateBoardLinkDto {
  @trim() @IsString() @MaxLength(2000)
  @Matches(/^https?:\/\//i, { message: 'Each link must start with http:// or https://' })
  url!: string;

  @IsOptional() @IsString() @MaxLength(200)
  label?: string;
}

/**
 * Body for POST /update-board. Was `@Body() body: any` — no validation at all, so any
 * key reached the service and any value reached the database.
 *
 * Status and priority stay free strings: they are CustomOption-backed ("task_status" /
 * "task_priority"), so the allowed set lives in the database, not in an enum here.
 */
export class CreateUpdateBoardPostDto {
  @IsString() @IsNotEmpty() @MaxLength(300)
  title!: string;

  @IsOptional() @IsString() @MaxLength(20000)
  body?: string;

  @IsOptional() @IsString() @MaxLength(64)
  status?: string;

  @IsOptional() @IsString() @MaxLength(64)
  priority?: string;

  @IsOptional() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsBoolean()
  pinned?: boolean;

  @IsOptional() @IsBoolean()
  restricted?: boolean;

  @IsOptional() @IsString() @MaxLength(64)
  projectId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  buildingId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  unitId?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => UpdateBoardLinkDto)
  links?: UpdateBoardLinkDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  assigneeIds?: string[];
}

/** Body for PUT /update-board/:id — every field optional; `null` clears the nullable ones. */
export class UpdateUpdateBoardPostDto {
  @IsOptional() @IsString() @MaxLength(300)
  title?: string;

  @IsOptional() @IsString() @MaxLength(20000)
  body?: string | null;

  @IsOptional() @IsString() @MaxLength(64)
  status?: string;

  @IsOptional() @IsString() @MaxLength(64)
  priority?: string;

  @IsOptional() @IsDateString()
  dueDate?: string | null;

  @IsOptional() @IsBoolean()
  pinned?: boolean;

  @IsOptional() @IsBoolean()
  restricted?: boolean;

  @IsOptional() @IsString() @MaxLength(64)
  projectId?: string | null;

  @IsOptional() @IsString() @MaxLength(64)
  buildingId?: string | null;

  @IsOptional() @IsString() @MaxLength(64)
  unitId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => UpdateBoardLinkDto)
  links?: UpdateBoardLinkDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  assigneeIds?: string[];
}

/** Body for POST /update-board/:id/attachments — the key comes back from /documents/upload-file. */
export class AddUpdateBoardAttachmentDto {
  @IsString() @IsStorageKey()
  storagePath!: string;

  @IsString() @IsNotEmpty() @MaxLength(255)
  fileName!: string;

  @IsOptional() @IsString() @MaxLength(255)
  mimeType?: string;
}

/** Body for a comment on a post (and on a task — see tasks.controller). */
export class CommentContentDto {
  @IsString() @IsNotEmpty() @MaxLength(5000)
  content!: string;
}
