import { vi } from 'vitest';

// Factory that creates a fresh mock for each model method
function mockModel() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  };
}

export function createPrismaMock() {
  return {
    user: mockModel(),
    farm: mockModel(),
    userFarmRole: mockModel(),
    assumption: mockModel(),
    monthlyData: mockModel(),
    monthlyDataFrozen: mockModel(),
    farmCategory: mockModel(),
    glAccount: mockModel(),
    glActualDetail: mockModel(),
    $transaction: vi.fn(async (fn) => fn({
      farmCategory: mockModel(),
      glAccount: mockModel(),
      glActualDetail: mockModel(),
    })),
    $disconnect: vi.fn(),
  };
}
