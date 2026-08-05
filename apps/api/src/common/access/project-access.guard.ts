import { Injectable, CanActivate, ExecutionContext, NotFoundException } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';

/**
 * Enforces project membership for scoped roles. Add AFTER JwtAuthGuard/PermissionsGuard
 * in @UseGuards so req.user is populated. For a scoped user, any project the request
 * resolves to that they're not a member of yields 404 (existence not leaked). Non-scoped
 * roles and requests with no resolvable project context pass through — cross-project list
 * endpoints filter by membership in their service instead.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(private readonly access: ProjectAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user || !this.access.isScoped(user.role, user.roles)) return true;

    const controllerName = context.getClass().name;
    const projectIds = await this.access.resolveProjectIds(controllerName, req);
    if (projectIds.length === 0) return true;

    for (const projectId of projectIds) {
      if (!(await this.access.isMember(user.sub, projectId))) {
        throw new NotFoundException('Project not found');
      }
    }
    return true;
  }
}
