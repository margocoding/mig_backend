/*
  Warnings:

  - You are about to drop the column `packPhotosPrice` on the `Flow` table. All the data in the column will be lost.
  - You are about to drop the column `singlePhotoPrice` on the `Flow` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Flow" DROP COLUMN "packPhotosPrice",
DROP COLUMN "singlePhotoPrice";

-- AlterTable
ALTER TABLE "Speech" ADD COLUMN     "price" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "singlePhotoPrice" INTEGER NOT NULL DEFAULT 400;
