import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import { WorkflowsService } from './workflows.service';
import { CreateWorkflowDto, SaveGroupDto, SaveWorkflowDto } from './dto/workflow.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkflowsController {
  constructor(private workflows: WorkflowsService) {}

  @Get('workflows')
  @Permission('workflows', 'view')
  list() {
    return this.workflows.list();
  }

  @Get('workflows/lookups')
  @Permission('workflows', 'view')
  async lookups() {
    const [staff, groups, documentTypes] = await Promise.all([
      this.workflows.staffUsers(),
      this.workflows.listGroups(),
      this.workflows.documentTypes(),
    ]);
    return { staff, groups, documentTypes };
  }

  @Get('workflows/:id')
  @Permission('workflows', 'view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.workflows.get(id);
  }

  @Post('workflows')
  @Permission('workflows', 'create')
  create(@Body() dto: CreateWorkflowDto) {
    return this.workflows.create(dto);
  }

  @Put('workflows/:id')
  @Permission('workflows', 'edit')
  save(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveWorkflowDto) {
    return this.workflows.save(id, dto);
  }

  @Delete('workflows/:id')
  @Permission('workflows', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.workflows.remove(id);
  }

  @Get('approver-groups')
  @Permission('workflows', 'view')
  groups() {
    return this.workflows.listGroups();
  }

  @Post('approver-groups')
  @Permission('workflows', 'create')
  createGroup(@Body() dto: SaveGroupDto) {
    return this.workflows.saveGroup(null, dto);
  }

  @Put('approver-groups/:id')
  @Permission('workflows', 'edit')
  updateGroup(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveGroupDto) {
    return this.workflows.saveGroup(id, dto);
  }

  @Delete('approver-groups/:id')
  @Permission('workflows', 'delete')
  removeGroup(@Param('id', ParseIntPipe) id: number) {
    return this.workflows.removeGroup(id);
  }
}
