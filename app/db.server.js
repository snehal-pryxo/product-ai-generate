import { PrismaClient } from "@prisma/client";

const createPrismaClient = () => new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

// Ensure all required tables exist — safe even if they already exist
async function ensureTables() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`generated_content_logs\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`shop\` VARCHAR(191) NOT NULL,
        \`productId\` VARCHAR(191) NOT NULL DEFAULT '',
        \`productTitle\` VARCHAR(191) NULL,
        \`intent\` VARCHAR(191) NOT NULL DEFAULT '',
        \`language\` VARCHAR(191) NULL,
        \`tone\` VARCHAR(191) NULL,
        \`lengthOption\` VARCHAR(191) NULL,
        \`formatOption\` VARCHAR(191) NULL,
        \`contextKeywords\` TEXT NULL,
        \`aiModel\` VARCHAR(191) NULL,
        \`generatedDescription\` LONGTEXT NULL,
        \`generatedSeoTitle\` VARCHAR(191) NULL,
        \`generatedSeoDescription\` TEXT NULL,
        \`appliedToProduct\` BOOLEAN NOT NULL DEFAULT false,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  } catch (_) { /* table already exists */ }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS \`GeneratedContentLog_shop_product_createdAt_idx\`
        ON \`generated_content_logs\`(\`shop\`, \`productId\`, \`createdAt\`)
    `);
  } catch (_) { /* index already exists */ }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`collection_generated_contents\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`shop\` VARCHAR(191) NOT NULL,
        \`collectionId\` VARCHAR(191) NOT NULL,
        \`collectionTitle\` VARCHAR(191) NULL,
        \`language\` VARCHAR(191) NULL,
        \`tone\` VARCHAR(191) NULL,
        \`lengthOption\` VARCHAR(191) NULL,
        \`formatOption\` VARCHAR(191) NULL,
        \`contextKeywords\` TEXT NULL,
        \`aiModel\` VARCHAR(191) NULL,
        \`descriptionHtml\` LONGTEXT NULL,
        \`seoTitle\` VARCHAR(191) NULL,
        \`seoDescription\` TEXT NULL,
        \`appliedToCollection\` BOOLEAN NOT NULL DEFAULT false,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  } catch (_) { /* table already exists */ }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS \`CollectionGeneratedContent_shop_collectionId_key\`
        ON \`collection_generated_contents\`(\`shop\`, \`collectionId\`)
    `);
  } catch (_) { /* index already exists */ }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS \`CollectionGeneratedContent_shop_updatedAt_idx\`
        ON \`collection_generated_contents\`(\`shop\`, \`updatedAt\`)
    `);
  } catch (_) { /* index already exists */ }
}

ensureTables().catch(console.error);

export default prisma;
