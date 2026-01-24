-- DropForeignKey
ALTER TABLE "Flow" DROP CONSTRAINT "Flow_eventId_fkey";

-- DropForeignKey
ALTER TABLE "Media" DROP CONSTRAINT "Media_memberId_fkey";

-- DropForeignKey
ALTER TABLE "Member" DROP CONSTRAINT "Member_speechId_fkey";

-- DropForeignKey
ALTER TABLE "OrderMedia" DROP CONSTRAINT "OrderMedia_mediaId_fkey";

-- DropForeignKey
ALTER TABLE "Speech" DROP CONSTRAINT "Speech_flowId_fkey";

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMedia" ADD CONSTRAINT "OrderMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_speechId_fkey" FOREIGN KEY ("speechId") REFERENCES "Speech"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Speech" ADD CONSTRAINT "Speech_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
