/*
  Warnings:

  - You are about to drop the column `price` on the `Media` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Speech` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Flow" ADD COLUMN     "packPhotosPrice" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "singlePhotoPrice" INTEGER NOT NULL DEFAULT 400;

-- AlterTable
ALTER TABLE "public"."Media" DROP COLUMN "price";

-- AlterTable
ALTER TABLE "public"."Speech" DROP COLUMN "price";
