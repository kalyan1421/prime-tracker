import { Controller, Get, Post, Put, Delete, Param, Patch, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { RequirePermissions, RequireMfa, CurrentUser } from '../../common/decorators/index';
import { UserRole } from '@prisma/client';
import { ROLE_PERMISSIONS, ROLE_META, PERMISSION_CATEGORIES } from '@prime-tracker/shared';
import { UserRole as SharedUserRole } from '@prime-tracker/shared';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, MfaGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'List all users' })
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Create a new user' })
  create(@Body() body: { email: string; name: string; role?: UserRole }) {
    return this.usersService.create(body);
  }

  @Get('roles')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Get role user counts' })
  getRoleCounts() {
    return this.usersService.getRoleCounts();
  }

  @Get('roles/definitions')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Get role definitions and permission matrix' })
  getRoleDefinitions() {
    return {
      roles: Object.values(SharedUserRole).map((role) => ({
        role,
        ...(ROLE_META[role] || {}),
        permissions: ROLE_PERMISSIONS[role] || [],
      })),
      permissionCategories: PERMISSION_CATEGORIES,
    };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your own profile (name/avatar)' })
  updateSelf(
    @Body() body: { name?: string; avatarUrl?: string },
    @CurrentUser('sub') userId: string,
  ) {
    return this.usersService.updateSelf(userId, body);
  }

  @Get(':id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Get user by ID' })
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id/role')
  @RequirePermissions('user:manage')
  @RequireMfa()
  @ApiOperation({ summary: 'Change user role (MFA required)' })
  updateRole(
    @Param('id') id: string,
    @Body() body: { role: UserRole },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.updateRole(id, body.role, actorId);
  }

  @Patch(':id/roles')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Set multiple roles for a user' })
  updateRoles(
    @Param('id') id: string,
    @Body() body: { roles: UserRole[] },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.updateRoles(id, body.roles, actorId);
  }

  @Patch(':id/status')
  @RequirePermissions('user:manage')
  @RequireMfa()
  @ApiOperation({ summary: 'Activate/deactivate user (MFA required)' })
  toggleActive(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.toggleActive(id, body.isActive, actorId);
  }

  @Put(':id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Update user name/email' })
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.update(id, body, actorId);
  }

  @Delete(':id')
  @RequirePermissions('user:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user' })
  remove(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.remove(id, actorId);
  }
}
