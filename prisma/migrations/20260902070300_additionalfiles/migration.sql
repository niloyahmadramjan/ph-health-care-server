/*
  Warnings:

  - Changed the type of `addionalFiles` on the `doctors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "resumePublicId" TEXT,
DROP COLUMN "addionalFiles",
ADD COLUMN     "addionalFiles" JSONB NOT NULL;
