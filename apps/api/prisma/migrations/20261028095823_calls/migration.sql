-- CreateEnum
CREATE TYPE "CallKind" AS ENUM ('audio', 'video');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ringing', 'active', 'ended', 'missed', 'declined');

-- CreateEnum
CREATE TYPE "CallParticipantStatus" AS ENUM ('ringing', 'joined', 'left', 'declined', 'missed', 'busy', 'forwarded');

-- CreateEnum
CREATE TYPE "ForwardMode" AS ENUM ('off', 'user', 'voicemail');

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "kind" "CallKind" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'ringing',
    "endReason" TEXT,
    "roomName" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "transferredById" TEXT,
    "transferredFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallParticipant" (
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CallParticipantStatus" NOT NULL,
    "isCaller" BOOLEAN NOT NULL DEFAULT false,
    "onHold" BOOLEAN NOT NULL DEFAULT false,
    "forwardedForId" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("callId","userId")
);

-- CreateTable
CREATE TABLE "Voicemail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "callId" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "listenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voicemail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSettings" (
    "userId" TEXT NOT NULL,
    "forwardMode" "ForwardMode" NOT NULL DEFAULT 'off',
    "forwardToId" TEXT,
    "alsoRingId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SpeedDial" (
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeedDial_pkey" PRIMARY KEY ("userId","contactId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_roomName_key" ON "Call"("roomName");

-- CreateIndex
CREATE INDEX "Call_status_idx" ON "Call"("status");

-- CreateIndex
CREATE INDEX "Call_conversationId_createdAt_idx" ON "Call"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "CallParticipant_userId_invitedAt_idx" ON "CallParticipant"("userId", "invitedAt");

-- CreateIndex
CREATE INDEX "CallParticipant_status_invitedAt_idx" ON "CallParticipant"("status", "invitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Voicemail_storageKey_key" ON "Voicemail"("storageKey");

-- CreateIndex
CREATE INDEX "Voicemail_userId_createdAt_idx" ON "Voicemail"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_forwardedForId_fkey" FOREIGN KEY ("forwardedForId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voicemail" ADD CONSTRAINT "Voicemail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voicemail" ADD CONSTRAINT "Voicemail_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voicemail" ADD CONSTRAINT "Voicemail_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSettings" ADD CONSTRAINT "CallSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSettings" ADD CONSTRAINT "CallSettings_forwardToId_fkey" FOREIGN KEY ("forwardToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSettings" ADD CONSTRAINT "CallSettings_alsoRingId_fkey" FOREIGN KEY ("alsoRingId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeedDial" ADD CONSTRAINT "SpeedDial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeedDial" ADD CONSTRAINT "SpeedDial_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
