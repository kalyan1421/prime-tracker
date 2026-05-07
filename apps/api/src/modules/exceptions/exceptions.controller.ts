import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExceptionsService } from './exceptions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * GET /api/exceptions          → portfolio-wide exception feed
 * GET /api/exceptions?projectId=:id  → per-project feed
 *
 * Read-only; cached 60s. Drives the dashboard "Needs Attention" panel and
 * the per-project Overview tab exception list.
 */
@ApiTags('Exceptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('exceptions')
export class ExceptionsController {
  constructor(private exceptions: ExceptionsService) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return projectId
      ? this.exceptions.forProject(projectId)
      : this.exceptions.forPortfolio();
  }
}
