import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  AdminUpdateUserInput, adminTeamActionSchema, adminTeamOwnerSchema, adminUpdateUserSchema, auditQuerySchema, AuditQuery,
  CreatePolicyInput, createPolicySchema, PolicyAssignmentsInput, policyAssignmentsSchema, UpdateOrgSettingsInput,
  updateOrgSettingsSchema, UpdatePolicyInput, updatePolicySchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AdminService } from './admin.service';
import { OrgService } from './org.service';
import { PolicyService } from './policy.service';

type TeamAction = z.infer<typeof adminTeamActionSchema>;
type TeamOwner = z.infer<typeof adminTeamOwnerSchema>;

/** Org info every client reads (the sign-in page too), the logo, and the caller's own effective policies. */
@Controller('org')
export class OrgController {
  constructor(
    private readonly org: OrgService,
    private readonly policies: PolicyService,
  ) {}

  @Public()
  @Get()
  info() {
    return this.org.info();
  }

  @Public()
  @Get('logo')
  async logo(@Query('v') v: string | undefined, @Res() res: Response) {
    const object = await this.org.logo(v);
    res.setHeader('Content-Type', object.contentType ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    object.body.pipe(res);
  }

  @Get('my-policies')
  myPolicies(@CurrentUser() me: AuthUser) {
    return this.policies.effective(me.id);
  }
}

@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly org: OrgService,
    private readonly policies: PolicyService,
  ) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  // ---- users (create / reset password live on /users, see UsersController)

  @Get('users')
  users(@Query('q') q = '', @Query('role') role?: string, @Query('status') status?: string) {
    return this.admin.users(q, role, status);
  }

  @Patch('users/:id')
  updateUser(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adminUpdateUserSchema)) body: AdminUpdateUserInput) {
    return this.admin.updateUser(me.id, id, body);
  }

  @Get('users/:id/policies')
  async userPolicies(@Param('id') id: string) {
    return this.policies.resolve(id);
  }

  // ---- teams & channels

  @Get('teams')
  teams(@Query('q') q = '') {
    return this.admin.teamsList(q);
  }

  @Post('teams/:id/action')
  @HttpCode(204)
  teamAction(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adminTeamActionSchema)) body: TeamAction) {
    return this.admin.teamAction({ id: me.id, role: 'admin' }, id, body.action);
  }

  @Put('teams/:id/owner')
  @HttpCode(204)
  teamOwner(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adminTeamOwnerSchema)) body: TeamOwner) {
    return this.admin.setTeamOwner(me.id, id, body.userId, body.owner);
  }

  @Get('teams/:id/channels')
  channels(@Param('id') id: string) {
    return this.admin.channels(id);
  }

  @Post('channels/:id/action')
  @HttpCode(204)
  channelAction(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adminTeamActionSchema)) body: TeamAction) {
    return this.admin.channelAction(me.id, id, body.action);
  }

  // ---- org settings

  @Put('org')
  updateOrg(@CurrentUser() me: AuthUser, @Body(new ZodPipe(updateOrgSettingsSchema)) body: UpdateOrgSettingsInput) {
    return this.org.update(me.id, body);
  }

  @Put('org/logo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  setLogo(@CurrentUser() me: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.org.setLogo(me.id, file ?? null);
  }

  @Delete('org/logo')
  removeLogo(@CurrentUser() me: AuthUser) {
    return this.org.setLogo(me.id, null);
  }

  // ---- policies

  @Get('policies')
  listPolicies() {
    return this.policies.list();
  }

  @Post('policies')
  createPolicy(@CurrentUser() me: AuthUser, @Body(new ZodPipe(createPolicySchema)) body: CreatePolicyInput) {
    return this.policies.create(me.id, body);
  }

  @Patch('policies/:id')
  updatePolicy(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updatePolicySchema)) body: UpdatePolicyInput) {
    return this.policies.update(me.id, id, body);
  }

  @Delete('policies/:id')
  @HttpCode(204)
  deletePolicy(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.policies.remove(me.id, id);
  }

  @Put('policies/:id/assignments')
  assignPolicy(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(policyAssignmentsSchema)) body: PolicyAssignmentsInput) {
    return this.policies.assign(me.id, id, body);
  }

  // ---- audit log

  @Get('audit')
  auditLog(@Query(new ZodPipe(auditQuerySchema)) query: AuditQuery) {
    return this.admin.auditLog(query);
  }

  @Get('audit.csv')
  async auditCsv(@CurrentUser() me: AuthUser, @Query(new ZodPipe(auditQuerySchema)) query: AuditQuery, @Res() res: Response) {
    const csv = await this.admin.auditCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    // BOM so Excel opens UTF-8 names correctly.
    res.send('﻿' + csv);
  }
}
