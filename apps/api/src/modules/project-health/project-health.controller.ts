import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProjectHealthService } from './project-health.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';

@ApiTags('Project Health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@Controller('projects')
export class ProjectHealthController {
  constructor(private health: ProjectHealthService) {}

  @Get(':id/health')
  getOne(@Param('id') id: string) {
    return this.health.score(id);
  }

  /**
   * Bulk endpoint used by /projects list page so it can fetch all scores in
   * one request instead of N individual calls.
   * Pass IDs as ?ids=a,b,c.
   */
  @Get('health/bulk')
  async getBulk(@Query('ids') idsCsv: string) {
    if (!idsCsv) return {};
    const ids = idsCsv.split(',').filter(Boolean);
    return this.health.scoreMany(ids);
  }
}
