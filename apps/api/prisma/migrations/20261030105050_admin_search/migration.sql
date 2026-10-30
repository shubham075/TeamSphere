-- AlterTable
-- Generated (Prisma models it as Unsupported): names are split on . _ - so "q3-budget.xlsx" matches "budget".
ALTER TABLE "FileItem" ADD COLUMN     "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace("name", '[._-]+', ' ', 'g'))) STORED;

-- AlterTable
-- Generated: English stemming over the body; mention markup @[Name](id) keeps the name searchable.
ALTER TABLE "Message" ADD COLUMN     "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "body")) STORED;

-- CreateTable
CREATE TABLE "OrgSetting" (
    "id" TEXT NOT NULL DEFAULT 'org',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "logoKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAssignment" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,

    CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Policy_type_idx" ON "Policy"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_type_name_key" ON "Policy"("type", "name");

-- CreateIndex
CREATE INDEX "PolicyAssignment_userId_idx" ON "PolicyAssignment"("userId");

-- CreateIndex
CREATE INDEX "PolicyAssignment_teamId_idx" ON "PolicyAssignment"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAssignment_policyId_userId_key" ON "PolicyAssignment"("policyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAssignment_policyId_teamId_key" ON "PolicyAssignment"("policyId", "teamId");

-- CreateIndex
CREATE INDEX "FileItem_searchVector_idx" ON "FileItem" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
