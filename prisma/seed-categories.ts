import type { Prisma } from '../src/generated/prisma/client.ts';

// iOS src/data/mockData.ts의 ID, 이름, 유형, symbol과 동일합니다.
export const defaultCategories = [
  { id: 'food', name: '식비', type: 'expense', symbol: 'food' },
  { id: 'coffee', name: '카페', type: 'expense', symbol: 'coffee' },
  { id: 'transport', name: '교통', type: 'expense', symbol: 'transport' },
  { id: 'shopping', name: '쇼핑', type: 'expense', symbol: 'shopping' },
  { id: 'living', name: '생활', type: 'expense', symbol: 'living' },
  { id: 'housing', name: '주거', type: 'expense', symbol: 'home' },
  { id: 'expense-other', name: '기타', type: 'expense', symbol: 'other' },
  { id: 'salary', name: '급여', type: 'income', symbol: 'income' },
  { id: 'allowance', name: '용돈', type: 'income', symbol: 'income' },
  { id: 'income-other', name: '기타', type: 'income', symbol: 'other' },
] satisfies Prisma.CategoryCreateInput[];

export async function seedCategories(client: Pick<Prisma.TransactionClient, 'category'>): Promise<void> {
  for (const category of defaultCategories) {
    const existingId = await client.category.findUnique({ where: { id: category.id } });
    if (existingId) continue;
    await client.category.upsert({
      where: { type_name: { type: category.type, name: category.name } },
      update: {},
      create: category,
    });
  }
}
