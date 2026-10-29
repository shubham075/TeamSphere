-- CreateEnum
CREATE TYPE "FileOwnerType" AS ENUM ('user', 'team', 'channel');

-- CreateEnum
CREATE TYPE "FileItemKind" AS ENUM ('file', 'folder');

-- CreateEnum
CREATE TYPE "FileShareRole" AS ENUM ('view', 'edit');

-- CreateEnum
CREATE TYPE "FileAccessRequestStatus" AS ENUM ('pending', 'approved', 'denied');

-- CreateTable
CREATE TABLE "FileItem" (
    "id" TEXT NOT NULL,
    "ownerType" "FileOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "FileItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT,
    "createdById" TEXT,
    "modifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "inRecycleBin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FileItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileShare" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FileShareRole" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "FileShareRole" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLinkUse" (
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLinkUse_pkey" PRIMARY KEY ("linkId","userId")
);

-- CreateTable
CREATE TABLE "FileAccessRequest" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "role" "FileShareRole" NOT NULL,
    "message" TEXT,
    "status" "FileAccessRequestStatus" NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileRecent" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileRecent_pkey" PRIMARY KEY ("userId","itemId")
);

-- CreateIndex
CREATE INDEX "FileItem_ownerType_ownerId_parentId_idx" ON "FileItem"("ownerType", "ownerId", "parentId");

-- CreateIndex
CREATE INDEX "FileItem_parentId_idx" ON "FileItem"("parentId");

-- CreateIndex
CREATE INDEX "FileItem_inRecycleBin_deletedAt_idx" ON "FileItem"("inRecycleBin", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_fileId_version_key" ON "FileVersion"("fileId", "version");

-- CreateIndex
CREATE INDEX "FileShare_userId_idx" ON "FileShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FileShare_itemId_userId_key" ON "FileShare"("itemId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_itemId_idx" ON "ShareLink"("itemId");

-- CreateIndex
CREATE INDEX "ShareLinkUse_userId_idx" ON "ShareLinkUse"("userId");

-- CreateIndex
CREATE INDEX "FileAccessRequest_itemId_status_idx" ON "FileAccessRequest"("itemId", "status");

-- CreateIndex
CREATE INDEX "FileAccessRequest_requesterId_idx" ON "FileAccessRequest"("requesterId");

-- CreateIndex
CREATE INDEX "FileRecent_userId_accessedAt_idx" ON "FileRecent"("userId", "accessedAt");

-- AddForeignKey
ALTER TABLE "FileItem" ADD CONSTRAINT "FileItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FileItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FileItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FileItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkUse" ADD CONSTRAINT "ShareLinkUse_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAccessRequest" ADD CONSTRAINT "FileAccessRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FileItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRecent" ADD CONSTRAINT "FileRecent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FileItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
