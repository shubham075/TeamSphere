import { Injectable } from '@nestjs/common';
import type { FileOwnerType, FileRole } from '@teamsphere/shared';
import { personalLibraryRole } from './files.logic';

/**
 * Who owns and manages a library. Only personal libraries exist today; Phase 2 plugs team and channel
 * membership in here (team owners → owner, members → edit) without touching the rest of the files module.
 */
@Injectable()
export class FileLibraries {
  async roleFor(userId: string, ownerType: FileOwnerType, ownerId: string): Promise<FileRole | null> {
    return personalLibraryRole(userId, ownerType, ownerId);
  }

  /** People who see the library's recycle bin and are asked to approve access requests. */
  async managers(ownerType: FileOwnerType, ownerId: string): Promise<string[]> {
    return ownerType === 'user' ? [ownerId] : [];
  }

  /** Libraries whose recycle bin and access requests `userId` manages. */
  async managedBy(userId: string): Promise<{ ownerType: FileOwnerType; ownerId: string }[]> {
    return [{ ownerType: 'user', ownerId: userId }];
  }
}
