import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomOptionsService } from './custom-options.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import {
  CreateCustomOptionDto, UpdateCustomOptionDto, ReorderCustomOptionsDto,
} from './dto/create-custom-option.dto';

@ApiTags('Custom Options')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, MfaGuard)
@Controller('custom-options')
export class CustomOptionsController {
  constructor(private service: CustomOptionsService) {}

  @Get('categories')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'List all option categories' })
  getCategories() {
    return this.service.findAllCategories();
  }

  @Get('defaults')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Get system default values by category' })
  getDefaults() {
    return this.service.getSystemDefaults();
  }

  @Get()
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'List options for a category (system + custom)' })
  findByCategory(@Query('category') category: string) {
    return this.service.findByCategory(category);
  }

  @Post()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Create a custom option' })
  create(
    @Body() body: CreateCustomOptionDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.create({ ...body, createdById: userId });
  }

  // MUST stay above @Patch(':id') — Nest matches in declaration order, so the wildcard
  // would otherwise swallow /reorder and try to update an option with id "reorder".
  @Patch('reorder')
  @RequirePermissions('settings:manage')
  @ApiOperation({
    summary: 'Reorder one category',
    description: 'Takes every option in the category exactly once, applied in one transaction.',
  })
  reorder(@Body() body: ReorderCustomOptionsDto) {
    return this.service.reorder(body.category, body.ids);
  }

  @Patch(':id')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Update a custom option label/color/sortOrder' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateCustomOptionDto,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Soft-delete a custom option' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
