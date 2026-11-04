import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChannelTab } from '@prisma/client';
import { ChannelTabApp, ChannelTabInfo, CreateChannelTabInput, PLANNER_WS_EVENTS } from '@teamsphere/shared';
import { FileLibraries } from '../files/file-libraries';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { canPlan, nextPosition } from './planner.logic';

/**
 * App tabs pinned to a channel after Posts / Files / Notes. Phase 8 apps add their own `app` value and a check that
 * the referenced item belongs to the channel. Everyone who can post files in the channel can add or remove tabs.
 */
@Injectable()
export class ChannelTabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly libraries: FileLibraries,
  ) {}

  async list(me: string, channelId: string): Promise<ChannelTabInfo[]> {
    if (!canPlan(await this.libraries.roleFor(me, 'channel', channelId), 'read')) throw new NotFoundException('Channel not found');
    const rows = await this.prisma.channelTab.findMany({ where: { channelId }, orderBy: { position: 'asc' } });
    return rows.map(present);
  }

  async add(me: string, channelId: string, input: CreateChannelTabInput): Promise<ChannelTabInfo> {
    await this.requireEdit(me, channelId);
    const title = input.title ?? (await this.checkRef(channelId, input.app, input.refId));
    if (input.title) await this.checkRef(channelId, input.app, input.refId);
    const existing = await this.prisma.channelTab.findUnique({ where: { channelId_app_refId: { channelId, app: input.app, refId: input.refId } } });
    if (existing) return present(existing);
    const positions = await this.prisma.channelTab.findMany({ where: { channelId }, select: { position: true } });
    const tab = await this.prisma.channelTab.create({
      data: { channelId, app: input.app, refId: input.refId, title, position: nextPosition(positions), createdById: me },
    });
    await this.changed(channelId);
    return present(tab);
  }

  async remove(me: string, channelId: string, tabId: string) {
    await this.requireEdit(me, channelId);
    const { count } = await this.prisma.channelTab.deleteMany({ where: { id: tabId, channelId } });
    if (!count) throw new NotFoundException('Tab not found');
    await this.changed(channelId);
  }

  /** Keeps tab titles in step when the app item is renamed. */
  async renameFor(app: ChannelTabApp, refId: string, title: string) {
    const tabs = await this.prisma.channelTab.findMany({ where: { app, refId }, select: { channelId: true } });
    if (!tabs.length) return;
    await this.prisma.channelTab.updateMany({ where: { app, refId }, data: { title: title.slice(0, 60) } });
    for (const channelId of new Set(tabs.map((t) => t.channelId))) await this.changed(channelId);
  }

  async removeFor(app: ChannelTabApp, refId: string) {
    const tabs = await this.prisma.channelTab.findMany({ where: { app, refId }, select: { channelId: true } });
    if (!tabs.length) return;
    await this.prisma.channelTab.deleteMany({ where: { app, refId } });
    for (const channelId of new Set(tabs.map((t) => t.channelId))) await this.changed(channelId);
  }

  private async requireEdit(me: string, channelId: string) {
    const role = await this.libraries.roleFor(me, 'channel', channelId);
    if (!role) throw new NotFoundException('Channel not found');
    if (!canPlan(role, 'edit')) throw new ForbiddenException('This channel is read-only');
  }

  /** The referenced item must belong to this channel. Returns its name as the default tab title. */
  private async checkRef(channelId: string, app: ChannelTabApp, refId: string): Promise<string> {
    switch (app) {
      case 'planner': {
        const plan = await this.prisma.plan.findFirst({ where: { id: refId, ownerType: 'channel', ownerId: channelId }, select: { title: true } });
        if (!plan) throw new BadRequestException('Only plans in this channel can be added as tabs');
        return plan.title.slice(0, 60);
      }
      case 'wiki':
        // The channel's whole page tree; one wiki tab per channel.
        if (refId !== channelId) throw new BadRequestException('A wiki tab shows its own channel’s pages');
        return 'Wiki';
      case 'whiteboard': {
        const board = await this.prisma.board.findFirst({ where: { id: refId, ownerType: 'channel', ownerId: channelId }, select: { title: true } });
        if (!board) throw new BadRequestException('Only whiteboards in this channel can be added as tabs');
        return board.title.slice(0, 60);
      }
      case 'list': {
        const list = await this.prisma.list.findFirst({ where: { id: refId, ownerType: 'channel', ownerId: channelId }, select: { title: true } });
        if (!list) throw new BadRequestException('Only lists in this channel can be added as tabs');
        return list.title.slice(0, 60);
      }
      case 'form': {
        const form = await this.prisma.form.findFirst({ where: { id: refId, ownerType: 'channel', ownerId: channelId }, select: { title: true } });
        if (!form) throw new BadRequestException('Only forms in this channel can be added as tabs');
        return form.title.slice(0, 60);
      }
    }
  }

  private async changed(channelId: string) {
    this.realtime.toUsers(await this.libraries.audience('channel', channelId), PLANNER_WS_EVENTS.tabsChanged, { channelId });
  }
}

const present = (t: ChannelTab): ChannelTabInfo => ({
  id: t.id,
  channelId: t.channelId,
  app: t.app as ChannelTabApp,
  refId: t.refId,
  title: t.title,
  position: t.position,
});
