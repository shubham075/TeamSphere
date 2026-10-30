import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreatePolicyInput, EffectivePolicies, EffectivePolicySource, POLICY_TYPES, PolicyAssignmentsInput, PolicyInfo,
  PolicyType, UpdatePolicyInput, WS_EVENTS,
} from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { normalizeSettings, PolicyCandidate, resolvePolicies } from './policies.logic';

const CACHE_MS = 30_000;

/**
 * The one place that answers "what is this person allowed to do". Services call `effective()` (or `assert()`) at
 * their enforcement points; results are cached briefly and the whole cache is dropped whenever a policy changes.
 */
@Injectable()
export class PolicyService {
  private cache = new Map<string, { at: number; value: { effective: EffectivePolicies; sources: EffectivePolicySource[] } }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async effective(userId: string): Promise<EffectivePolicies> {
    return (await this.resolve(userId)).effective;
  }

  async resolve(userId: string) {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const teamIds = (await this.prisma.teamMember.findMany({ where: { userId, team: { deletedAt: null } }, select: { teamId: true } })).map((t) => t.teamId);
    const policies = await this.prisma.policy.findMany({
      where: { OR: [{ isDefault: true }, { assignments: { some: { OR: [{ userId }, ...(teamIds.length ? [{ teamId: { in: teamIds } }] : [])] } } }] },
      include: { assignments: { where: { OR: [{ userId }, { teamId: { in: teamIds } }] } } },
    });
    const candidates: PolicyCandidate[] = [];
    for (const p of policies) {
      const base = { id: p.id, type: p.type, name: p.name, settings: p.settings };
      if (p.assignments.some((a) => a.userId === userId)) candidates.push({ ...base, via: 'user' });
      else if (p.assignments.some((a) => a.teamId)) candidates.push({ ...base, via: 'team' });
      if (p.isDefault) candidates.push({ ...base, via: 'default' });
    }
    const value = resolvePolicies(candidates);
    this.cache.set(userId, { at: Date.now(), value });
    return value;
  }

  /** Throws 403 with `message` unless `check` passes for this person's effective policies. */
  async assert(userId: string, check: (p: EffectivePolicies) => boolean, message: string): Promise<void> {
    if (!check(await this.effective(userId))) throw new ForbiddenException(message);
  }

  /** Team membership changes can change someone's policies. */
  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  // ---------------------------------------------------------------- admin CRUD

  async list(): Promise<PolicyInfo[]> {
    const rows = await this.prisma.policy.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }], include: { assignments: true } });
    const userIds = [...new Set(rows.flatMap((r) => r.assignments.map((a) => a.userId).filter((x): x is string => !!x)))];
    const teamIds = [...new Set(rows.flatMap((r) => r.assignments.map((a) => a.teamId).filter((x): x is string => !!x)))];
    const [users, teams] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }),
      this.prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } }),
    ]);
    const u = new Map(users.map((x) => [x.id, x]));
    const t = new Map(teams.map((x) => [x.id, x]));
    return rows.map((r) => ({
      id: r.id,
      type: r.type as PolicyType,
      name: r.name,
      description: r.description,
      settings: normalizeSettings(r.type as PolicyType, r.settings) as Record<string, unknown>,
      isDefault: r.isDefault,
      users: r.assignments.flatMap((a) => (a.userId && u.get(a.userId) ? [u.get(a.userId)!] : [])),
      teams: r.assignments.flatMap((a) => (a.teamId && t.get(a.teamId) ? [t.get(a.teamId)!] : [])),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async create(actorId: string, input: CreatePolicyInput): Promise<PolicyInfo> {
    if (!POLICY_TYPES.includes(input.type)) throw new BadRequestException('Unknown policy type');
    const settings = normalizeSettings(input.type, input.settings) as Prisma.InputJsonValue;
    const row = await this.prisma.policy
      .create({ data: { type: input.type, name: input.name, description: input.description, settings } })
      .catch((e) => this.uniqueName(e));
    this.audit.log({ actorId, action: 'admin.policy_created', targetType: 'policy', targetId: row.id, meta: { type: row.type, name: row.name } });
    this.changed();
    return this.one(row.id);
  }

  async update(actorId: string, id: string, input: UpdatePolicyInput): Promise<PolicyInfo> {
    const row = await this.require(id);
    const settings = input.settings ? (normalizeSettings(row.type as PolicyType, { ...(row.settings as object), ...input.settings }) as Prisma.InputJsonValue) : undefined;
    await this.prisma.policy
      .update({ where: { id }, data: { name: input.name, description: input.description, settings } })
      .catch((e) => this.uniqueName(e));
    this.audit.log({ actorId, action: 'admin.policy_updated', targetType: 'policy', targetId: id, meta: { settings: settings ?? null } as Prisma.InputJsonValue });
    this.changed();
    return this.one(id);
  }

  async remove(actorId: string, id: string): Promise<void> {
    const row = await this.require(id);
    await this.prisma.policy.delete({ where: { id } });
    this.audit.log({ actorId, action: 'admin.policy_deleted', targetType: 'policy', targetId: id, meta: { name: row.name } });
    this.changed();
  }

  async assign(actorId: string, id: string, input: PolicyAssignmentsInput): Promise<PolicyInfo> {
    const row = await this.require(id);
    const [users, teams] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: input.userIds } }, select: { id: true } }),
      this.prisma.team.findMany({ where: { id: { in: input.teamIds }, deletedAt: null }, select: { id: true } }),
    ]);
    await this.prisma.$transaction(async (tx) => {
      await tx.policyAssignment.deleteMany({ where: { policyId: id } });
      await tx.policyAssignment.createMany({
        data: [...users.map((u) => ({ policyId: id, userId: u.id })), ...teams.map((t) => ({ policyId: id, teamId: t.id }))],
      });
      if (input.isDefault !== undefined) {
        // One org default per type.
        if (input.isDefault) await tx.policy.updateMany({ where: { type: row.type, isDefault: true, NOT: { id } }, data: { isDefault: false } });
        await tx.policy.update({ where: { id }, data: { isDefault: input.isDefault } });
      }
    });
    this.audit.log({
      actorId,
      action: 'admin.policy_assigned',
      targetType: 'policy',
      targetId: id,
      meta: { users: users.length, teams: teams.length, isDefault: input.isDefault ?? row.isDefault },
    });
    this.changed();
    return this.one(id);
  }

  private async one(id: string): Promise<PolicyInfo> {
    const found = (await this.list()).find((p) => p.id === id);
    if (!found) throw new NotFoundException('Policy not found');
    return found;
  }

  private async require(id: string) {
    const row = await this.prisma.policy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Policy not found');
    return row;
  }

  private uniqueName(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A policy of this type with that name already exists');
    throw e;
  }

  private changed() {
    this.invalidate();
    this.realtime.toAll(WS_EVENTS.orgUpdated, { policies: true });
  }
}
