-- CreateEnum
CREATE TYPE "MeetingRole" AS ENUM ('organizer', 'coorganizer', 'presenter', 'attendee');

-- CreateEnum
CREATE TYPE "MeetingRsvp" AS ENUM ('none', 'accepted', 'tentative', 'declined');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "recurrence" JSONB,
    "exceptions" JSONB NOT NULL DEFAULT '{}',
    "joinCode" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'meeting',
    "isInstant" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MeetingRole" NOT NULL DEFAULT 'attendee',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "rsvp" "MeetingRsvp" NOT NULL DEFAULT 'none',
    "rsvpNote" TEXT,
    "proposedStartAt" TIMESTAMP(3),
    "proposedEndAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("meetingId","userId")
);

-- CreateTable
CREATE TABLE "MeetingSession" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "roomName" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MeetingRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "MeetingAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHours" (
    "userId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "days" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingHours_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_joinCode_key" ON "Meeting"("joinCode");

-- CreateIndex
CREATE INDEX "Meeting_conversationId_idx" ON "Meeting"("conversationId");

-- CreateIndex
CREATE INDEX "Meeting_startAt_idx" ON "Meeting"("startAt");

-- CreateIndex
CREATE INDEX "MeetingAttendee_userId_idx" ON "MeetingAttendee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSession_roomName_key" ON "MeetingSession"("roomName");

-- CreateIndex
CREATE INDEX "MeetingSession_meetingId_endedAt_idx" ON "MeetingSession"("meetingId", "endedAt");

-- CreateIndex
CREATE INDEX "MeetingAttendance_sessionId_userId_idx" ON "MeetingAttendance"("sessionId", "userId");

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSession" ADD CONSTRAINT "MeetingSession_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MeetingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
