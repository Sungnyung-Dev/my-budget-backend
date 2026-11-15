import type { Category, Prisma } from '../src/generated/prisma/client.ts';

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

type SeedCategory = Pick<Category, 'id' | 'name' | 'type' | 'symbol'>;

export class CategorySeedConflict extends Error {
  constructor(id: string) {
    super(`기본 카테고리 ${id}: ID·유형 또는 유형별 이름이 기존 데이터와 충돌합니다. 기존 데이터는 보존합니다.`);
    this.name = 'CategorySeedConflict';
  }
}

interface SeedOptions {
  strict?: boolean;
  categories?: readonly SeedCategory[];
}

export async function seedCategories(
  client: Pick<Prisma.TransactionClient, 'category'>,
  { strict = false, categories = defaultCategories }: SeedOptions = {},
): Promise<{ created: number; preserved: number }> {
  let created = 0;
  let preserved = 0;
  for (const category of categories) {
    const existingId = await client.category.findUnique({ where: { id: category.id } });
    if (strict) {
      const existingName = await client.category.findUnique({
        where: { type_name: { type: category.type, name: category.name } },
      });
      if ((existingId && existingId.type !== category.type) || (existingName && existingName.id !== category.id)) {
        throw new CategorySeedConflict(category.id);
      }
      if (existingId) {
        preserved++;
      } else {
        await client.category.create({ data: category });
        created++;
      }
      continue;
    }
    if (existingId) { preserved++; continue; }
    const saved = await client.category.upsert({
      where: { type_name: { type: category.type, name: category.name } },
      update: {},
      create: category,
    });
    if (saved.id === category.id) created++;
    else preserved++;
  }
  return { created, preserved };
}
