import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

// All fields optional for PATCH-like updates
export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  /**
   * Publishes this project's units to the website property with this slug; null
   * unpublishes. Update-only: a project is created first and published once its
   * units are in, or the website would mirror an empty inventory.
   */
  @IsOptional() @IsString() @MaxLength(120)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'websiteSlug must be lowercase letters/numbers with optional dashes',
  })
  websiteSlug?: string | null;
}
