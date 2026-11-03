-- CreateEnum
CREATE TYPE "PageOwnerType" AS ENUM ('user', 'channel', 'meeting');

-- CreateEnum
CREATE TYPE "BoardOwnerType" AS ENUM ('user', 'channel');

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "ownerType" "PageOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "rootId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "icon" TEXT,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "state" BYTEA,
    "text" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageMember" (
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageMember_pkey" PRIMARY KEY ("pageId","userId")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "ownerType" "BoardOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" BYTEA,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardMember" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("boardId","userId")
);

-- CreateIndex
CREATE INDEX "Page_ownerType_ownerId_idx" ON "Page"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Page_rootId_idx" ON "Page"("rootId");

-- CreateIndex
CREATE INDEX "Page_parentId_idx" ON "Page"("parentId");

-- CreateIndex
CREATE INDEX "PageMember_userId_idx" ON "PageMember"("userId");

-- CreateIndex
CREATE INDEX "Board_ownerType_ownerId_idx" ON "Board"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "BoardMember_userId_idx" ON "BoardMember"("userId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageMember" ADD CONSTRAINT "PageMember_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
