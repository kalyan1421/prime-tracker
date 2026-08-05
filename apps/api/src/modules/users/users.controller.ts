import { Controller, Get, Post, Put, Delete, Param, Patch, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserPasswordDto } from './dto/set-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { UserRole } from '@prisma/client';
import { ROLE_PERMISSIONS, ROLE_META, PERMISSION_CATEGORIES } from '@prime-tracker/shared';
import { UserRole as SharedUserRole } from '@prime-tracker/shared';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
  create(@Body() body: { email: string; name: string; role?: UserRole; roles?: UserRole[]; password?: string }) {
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

  // No @RequirePermissions: any authenticated user may edit their OWN identity. The
  // DTO is what keeps this safe — it has no role/roles/isActive/email field, so the
  // global ValidationPipe rejects an attempt to smuggle one in.
  @Patch('me')
  @ApiOperation({ summary: 'Update your own profile (name, avatar, phone, job title)' })
  updateSelf(
    @Body() body: UpdateProfileDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.usersService.updateSelf(userId, body);
  }

  // Declared before @Get(':id') — Nest matches routes in order, and otherwise
  // "assignable" would be captured as an :id and 403 on user:manage.
  @Get('assignable')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Active users that work can be assigned to (any signed-in role)' })
  findAssignable() {
    return this.usersService.findAssignable();
  }

  @Get(':id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Get user by ID' })
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id/role')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Change user role' })
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
  @ApiOperation({ summary: 'Activate/deactivate user' })
  toggleActive(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.usersService.toggleActive(id, body.isActive, actorId);
  }

  @Patch(':id/password')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: "Reset another user's password (revokes all their sessions)" })
  setPassword(
    @Param('id') id: string,
    @Body() body: SetUserPasswordDto,
    @CurrentUser('sub') actorId: string,
    @CurrentUser('role') actorRole: string,
    @CurrentUser('roles') actorRoles: string[],
  ) {
    return this.usersService.setPassword(id, body.newPassword, {
      id: actorId,
      role: actorRole,
      roles: actorRoles,
    });
  }

  @Put(':id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: "Update another user's details (name, email, phone, job title)" })
  update(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
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
