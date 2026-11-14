-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(20) COLLATE utf8mb4_0900_as_ci NOT NULL,
    `type` ENUM('expense', 'income') NOT NULL,
    `symbol` ENUM('food', 'coffee', 'transport', 'shopping', 'living', 'home', 'income', 'other') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_type_name_key`(`type`, `name`),
    UNIQUE INDEX `Category_id_type_key`(`id`, `type`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Category_name_not_empty` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
    CONSTRAINT `Category_id_not_empty` CHECK (CHAR_LENGTH(`id`) > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `type` ENUM('expense', 'income') NOT NULL,
    `amount` BIGINT NOT NULL,
    `date` DATE NOT NULL,
    `memo` VARCHAR(100) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Transaction_date_idx`(`date`),
    INDEX `Transaction_categoryId_type_idx`(`categoryId`, `type`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Transaction_amount_range` CHECK (`amount` BETWEEN 1 AND 999999999999),
    CONSTRAINT `Transaction_date_range` CHECK (`date` BETWEEN '1900-01-01' AND '9999-12-31'),
    CONSTRAINT `Transaction_id_not_empty` CHECK (CHAR_LENGTH(`id`) > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_categoryId_type_fkey` FOREIGN KEY (`categoryId`, `type`) REFERENCES `Category`(`id`, `type`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma 스키마로 표현할 수 없는 불변 규칙입니다. db push 대신 마이그레이션을 사용하세요.
CREATE TRIGGER `Category_type_immutable`
BEFORE UPDATE ON `Category`
FOR EACH ROW
BEGIN
    IF NEW.`type` <> OLD.`type` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Category type cannot be changed';
    END IF;
END;
