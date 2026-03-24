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
    aggregate: vi.fn(),
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
    labourPlan: mockModel(),
    labourSeason: mockModel(),
    labourRole: mockModel(),
    labourActual: mockModel(),
    monthlyActual: mockModel(),
    commodity: mockModel(),
    inventoryBin: mockModel(),
    inventoryLocation: mockModel(),
    counterparty: mockModel(),
    marketingContract: mockModel(),
    marketPrice: mockModel(),
    cashFlowEntry: mockModel(),
    priceAlert: mockModel(),
    deliveryTicket: mockModel(),
    settlement: mockModel(),
    settlementLine: mockModel(),
    farmInvite: mockModel(),
    agroPlan: mockModel(),
    cropAllocation: mockModel(),
    cropInput: mockModel(),
    agroProduct: mockModel(),
    $transaction: vi.fn(async (fn) => fn({
      farmCategory: mockModel(),
      glAccount: mockModel(),
      glActualDetail: mockModel(),
    })),
    $disconnect: vi.fn(),
  };
}
