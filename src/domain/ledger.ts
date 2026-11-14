import type { Category, Transaction, TransactionType } from '../generated/prisma/client.ts';

export const MAX_AMOUNT = 999_999_999_999;

export type CategoryDto = Pick<Category, 'id' | 'name' | 'type' | 'symbol'>;
export interface TransactionDto {
  id: string;
  date: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  memo: string;
}
export interface LedgerDataDto {
  version: 1;
  transactions: TransactionDto[];
  categories: CategoryDto[];
}

export function amountToBigInt(amount: number): bigint {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
    throw new RangeError('금액은 1~999,999,999,999원의 안전한 정수여야 합니다.');
  }
  return BigInt(amount);
}

export function amountToNumber(amount: bigint): number {
  if (amount < 1n || amount > BigInt(MAX_AMOUNT) || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('저장 금액이 허용 범위를 벗어났습니다.');
  }
  return Number(amount);
}

export function dateToPrisma(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') {
    throw new RangeError('날짜는 1900~9999년의 YYYY-MM-DD 형식이어야 합니다.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('실제로 존재하는 날짜여야 합니다.');
  }
  return date;
}

export function dateToString(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('저장 날짜가 올바르지 않습니다.');
  const value = date.toISOString().slice(0, 10);
  dateToPrisma(value);
  return value;
}

export function normalizeCategoryName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 20) throw new RangeError('카테고리 이름은 1~20자여야 합니다.');
  return name;
}

export function normalizeMemo(value: string): string {
  const memo = value.trim();
  if (memo.length > 100) throw new RangeError('메모는 100자 이하여야 합니다.');
  return memo;
}

export function toCategoryDto(category: Category): CategoryDto {
  const { id, name, type, symbol } = category;
  return { id, name, type, symbol };
}

export function toTransactionDto(transaction: Transaction): TransactionDto {
  const { id, date, type, amount, categoryId, memo } = transaction;
  return { id, date: dateToString(date), type, amount: amountToNumber(amount), categoryId, memo };
}

export function toLedgerDto(categories: Category[], transactions: Transaction[]): LedgerDataDto {
  // iOS는 개별 금액뿐 아니라 전체 거래 금액의 합도 안전한 정수인지 검사합니다.
  const total = transactions.reduce((sum, transaction) => sum + transaction.amount, 0n);
  assertLedgerTotal(total);
  return { version: 1, categories: categories.map(toCategoryDto), transactions: transactions.map(toTransactionDto) };
}

export function assertLedgerTotal(total: bigint): void {
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('전체 거래 금액이 iOS의 안전한 정수 범위를 초과했습니다.');
  }
}
