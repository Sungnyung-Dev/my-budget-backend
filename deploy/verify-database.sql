-- 마이그레이션 후, 선택한 DB에서만 실행하는 읽기 전용 점검입니다.
SELECT DATABASE() AS database_name, CURRENT_USER() AS account, @@hostname AS server,
       @@port AS port, VERSION() AS mysql_version;

SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
FROM `_prisma_migrations` ORDER BY started_at;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('Category', 'Transaction');

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('Category', 'Transaction')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.ENFORCED, cc.CHECK_CLAUSE
FROM information_schema.TABLE_CONSTRAINTS tc
JOIN information_schema.CHECK_CONSTRAINTS cc
  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.CONSTRAINT_TYPE = 'CHECK';

SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE();

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('Category', 'Transaction')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, DEFINER, ACTION_STATEMENT
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();

SELECT id, name, type, symbol FROM `Category`
WHERE id IN ('food', 'coffee', 'transport', 'shopping', 'living', 'housing', 'expense-other',
             'salary', 'allowance', 'income-other')
ORDER BY type, name, id;

SELECT COUNT(*) AS orphan_or_mismatched_transactions
FROM `Transaction` t LEFT JOIN `Category` c ON c.id = t.categoryId AND c.type = t.type
WHERE c.id IS NULL;

SELECT COUNT(*) AS transaction_count, COALESCE(SUM(amount), 0) AS gross_amount,
       COALESCE(SUM(amount), 0) <= 9007199254740991 AS total_is_safe
FROM `Transaction`;
