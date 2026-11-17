-- 금융 테이블과 기존 데이터는 변경하지 않습니다.
CREATE TABLE `Session` (
    `tokenHash` CHAR(64) NOT NULL,
    `csrfToken` VARCHAR(43) NOT NULL,
    `credentialVersion` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
