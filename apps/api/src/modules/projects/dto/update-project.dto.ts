import { PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';

// All fields optional for PATCH-like updates
export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
