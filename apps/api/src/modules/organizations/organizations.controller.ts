import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('organizations')
export class OrganizationsController {
  constructor(private orgService: OrganizationsService) {}

  @Post()
  @RequirePermissions('org:manage')
  @ApiOperation({ summary: 'Create a new organization' })
  create(
    @Body() body: { name: string; entityType?: string; description?: string },
    @CurrentUser('sub') userId: string,
  ) {
    return this.orgService.create(body, userId);
  }

  @Get()
  @RequirePermissions('org:manage')
  @ApiOperation({ summary: 'List all organizations' })
  findAll() {
    return this.orgService.findAll();
  }

  @Get(':id')
  @RequirePermissions('org:manage')
  @ApiOperation({ summary: 'Get organization by ID with members' })
  findById(@Param('id') id: string) {
    return this.orgService.findById(id);
  }

  @Put(':id')
  @RequirePermissions('org:manage')
  @ApiOperation({ summary: 'Update organization details' })
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; entityType?: string; description?: string },
    @CurrentUser('sub') userId: string,
  ) {
    return this.orgService.update(id, body, userId);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('org:manage')
  @ApiOperation({ summary: 'Deactivate an organization' })
  deactivate(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.orgService.deactivate(id, userId);
  }

  @Post(':id/members')
  @RequirePermissions('org:manage')
  @ApiOperation({ summary: 'Add a member to an organization' })
  addMember(
    @Param('id') orgId: string,
    @Body() body: { userId: string; orgRole: string },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.orgService.addMember(orgId, body.userId, body.orgRole, actorId);
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('org:manage')
  @ApiOperation({ summary: 'Remove a member from an organization' })
  removeMember(
    @Param('id') orgId: string,
    @Param('userId') userId: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.orgService.removeMember(orgId, userId, actorId);
  }
}
