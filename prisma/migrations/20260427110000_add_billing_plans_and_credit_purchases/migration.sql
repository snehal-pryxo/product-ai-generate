ALTER TABLE `shop`
  ADD COLUMN IF NOT EXISTS `billingPlanKey` VARCHAR(32) NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS `billingPlanName` VARCHAR(100) NULL DEFAULT 'Free',
  ADD COLUMN IF NOT EXISTS `billingPlanCredits` INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS `billingPlanPrice` DECIMAL(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS `billingSubscriptionId` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `billingSubscriptionStatus` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `billingPlanActivatedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `billingCreditsRenewedAt` DATETIME(3) NULL;

CREATE TABLE IF NOT EXISTS `billing_subscriptions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(191) NOT NULL,
  `planKey` VARCHAR(32) NOT NULL,
  `planName` VARCHAR(100) NOT NULL,
  `credits` INT NOT NULL,
  `price` DECIMAL(10, 2) NOT NULL,
  `subscriptionId` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `creditedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
);

SET @idx_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'billing_subscriptions'
    AND index_name = 'BillingSubscription_subscriptionId_key'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `BillingSubscription_subscriptionId_key` ON `billing_subscriptions`(`subscriptionId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'billing_subscriptions'
    AND index_name = 'BillingSubscription_shop_createdAt_idx'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `BillingSubscription_shop_createdAt_idx` ON `billing_subscriptions`(`shop`, `createdAt`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `billing_credit_purchases` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(191) NOT NULL,
  `packageKey` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `credits` INT NOT NULL,
  `price` DECIMAL(10, 2) NOT NULL,
  `purchaseId` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `creditedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
);

SET @idx_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'billing_credit_purchases'
    AND index_name = 'BillingCreditPurchase_purchaseId_key'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `BillingCreditPurchase_purchaseId_key` ON `billing_credit_purchases`(`purchaseId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'billing_credit_purchases'
    AND index_name = 'BillingCreditPurchase_shop_createdAt_idx'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `BillingCreditPurchase_shop_createdAt_idx` ON `billing_credit_purchases`(`shop`, `createdAt`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
