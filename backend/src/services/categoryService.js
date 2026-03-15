import prisma from '../config/database.js';
import { DEFAULT_CATEGORIES, generateCropRevenueCategories, DEFAULT_GL_ACCOUNTS } from '../utils/defaultCategoryTemplate.js';

// Simple in-memory cache: farmId -> { categories, expiresAt }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100; // max farms cached

function getCached(farmId) {
  const entry = cache.get(farmId);
  if (entry && entry.expiresAt > Date.now()) return entry.categories;
  if (entry) cache.delete(farmId); // expired — clean up
  return null;
}

function setCache(farmId, categories) {
  // Evict oldest entry if at capacity
  if (!cache.has(farmId) && cache.size >= CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(farmId, { categories, expiresAt: Date.now() + CACHE_TTL });
}

export function invalidateCache(farmId) {
  cache.delete(farmId);
}

// Get full category hierarchy for a farm, sorted by sort_order
export async function getFarmCategories(farmId) {
  const cached = getCached(farmId);
  if (cached) return cached;

  let categories = await prisma.farmCategory.findMany({
    where: { farm_id: farmId, is_active: true },
    orderBy: { sort_order: 'asc' },
  });

  // Auto-initialize if empty
  if (categories.length === 0) {
    const assumption = await prisma.assumption.findFirst({
      where: { farm_id: farmId },
      orderBy: { fiscal_year: 'desc' },
    });
    const crops = assumption?.crops_json || [];
    await initFarmCategories(farmId, crops);
    categories = await prisma.farmCategory.findMany({
      where: { farm_id: farmId, is_active: true },
      orderBy: { sort_order: 'asc' },
    });
  }

  setCache(farmId, categories);
  return categories;
}

// Leaf categories (no children)
export async function getFarmLeafCategories(farmId) {
  const all = await getFarmCategories(farmId);
  const parentIds = new Set(all.filter(c => c.parent_id).map(c => c.parent_id));
  return all.filter(c => !parentIds.has(c.id));
}

// Parent categories (have children)
export async function getFarmParentCategories(farmId) {
  const all = await getFarmCategories(farmId);
  const parentIds = new Set(all.filter(c => c.parent_id).map(c => c.parent_id));
  return all.filter(c => parentIds.has(c.id));
}

// Get children codes for a parent code
export async function getChildrenCodes(farmId, parentCode) {
  const all = await getFarmCategories(farmId);
  const parent = all.find(c => c.code === parentCode);
  if (!parent) return [];
  return all.filter(c => c.parent_id === parent.id).map(c => c.code);
}

// Recalculate parent sums dynamically using farm's category hierarchy
export function recalcParentSums(dataJson, farmCategories) {
  const updated = { ...dataJson };

  // Build parent/child relationships
  const parentIds = new Set(farmCategories.filter(c => c.parent_id).map(c => c.parent_id));
  const parents = farmCategories.filter(c => parentIds.has(c.id));

  // Sort parents bottom-up by level (deepest first)
  const sorted = [...parents].sort((a, b) => b.level - a.level);

  for (const parent of sorted) {
    const children = farmCategories.filter(c => c.parent_id === parent.id);
    updated[parent.code] = children.reduce((sum, child) => sum + (updated[child.code] || 0), 0);
  }

  return updated;
}

// Initialize farm categories from default template
export async function initFarmCategories(farmId, crops = []) {
  // Generate crop revenue categories
  const cropCategories = generateCropRevenueCategories(crops);
  // Deep copy to avoid mutating module-level DEFAULT_CATEGORIES objects
  const allTemplateCategories = DEFAULT_CATEGORIES.map(c => ({ ...c }));

  // Insert crop revenue categories right after 'revenue' parent (before 'rev_other_income')
  const revenueIdx = allTemplateCategories.findIndex(c => c.code === 'rev_other_income');
  if (revenueIdx >= 0) {
    allTemplateCategories.splice(revenueIdx, 0, ...cropCategories);
  } else {
    allTemplateCategories.push(...cropCategories);
  }

  // Renumber sort_order after insert to avoid conflicts
  // Keep section boundaries (100, 200, 300, 400) for non-revenue items
  let revSortOrder = 2;
  for (const cat of allTemplateCategories) {
    if (cat.ref === 'revenue' || cat.code === 'revenue') {
      if (cat.code === 'revenue') {
        cat.sort_order = 1;
      } else {
        cat.sort_order = revSortOrder++;
      }
    }
  }

  // Create categories in a transaction
  await prisma.$transaction(async (tx) => {
    // First pass: create all top-level parents (ref === null)
    const codeToId = {};

    for (const cat of allTemplateCategories) {
      if (cat.ref !== null) continue;
      const created = await tx.farmCategory.upsert({
        where: { farm_id_code: { farm_id: farmId, code: cat.code } },
        update: {
          display_name: cat.display_name,
          level: cat.level,
          sort_order: cat.sort_order,
          category_type: cat.category_type,
          path: cat.code,
          is_active: true,
        },
        create: {
          farm_id: farmId,
          code: cat.code,
          display_name: cat.display_name,
          parent_id: null,
          path: cat.code,
          level: cat.level,
          sort_order: cat.sort_order,
          category_type: cat.category_type,
        },
      });
      codeToId[cat.code] = created.id;
    }

    // Second pass: create children
    for (const cat of allTemplateCategories) {
      if (cat.ref === null) continue;
      const parentId = codeToId[cat.ref];
      if (!parentId) continue;

      const created = await tx.farmCategory.upsert({
        where: { farm_id_code: { farm_id: farmId, code: cat.code } },
        update: {
          display_name: cat.display_name,
          parent_id: parentId,
          level: cat.level,
          sort_order: cat.sort_order,
          category_type: cat.category_type,
          path: `${cat.ref}.${cat.code}`,
          is_active: true,
        },
        create: {
          farm_id: farmId,
          code: cat.code,
          display_name: cat.display_name,
          parent_id: parentId,
          path: `${cat.ref}.${cat.code}`,
          level: cat.level,
          sort_order: cat.sort_order,
          category_type: cat.category_type,
        },
      });
      codeToId[cat.code] = created.id;
    }

    // Create default GL accounts
    for (const gl of DEFAULT_GL_ACCOUNTS) {
      const categoryId = codeToId[gl.category_code] || null;
      await tx.glAccount.upsert({
        where: { farm_id_account_number: { farm_id: farmId, account_number: gl.account_number } },
        update: {
          account_name: gl.account_name,
          category_id: categoryId,
        },
        create: {
          farm_id: farmId,
          account_number: gl.account_number,
          account_name: gl.account_name,
          category_id: categoryId,
        },
      });
    }
  });

  invalidateCache(farmId);
}

// Get farm categories formatted like the old CATEGORY_HIERARCHY structure
export async function getFarmCategoryHierarchy(farmId) {
  const categories = await getFarmCategories(farmId);
  return categories.map(cat => ({
    id: cat.id,
    code: cat.code,
    display_name: cat.display_name,
    parent_id: cat.parent_id,
    path: cat.path,
    level: cat.level,
    sort_order: cat.sort_order,
    category_type: cat.category_type,
  }));
}

// Validate a code is a leaf category for the farm
export async function validateLeafCategory(farmId, code) {
  const leaves = await getFarmLeafCategories(farmId);
  const leafCodes = new Set(leaves.map(c => c.code));
  if (!leafCodes.has(code)) {
    throw Object.assign(new Error(`Invalid or non-leaf category code: ${code}`), { status: 400 });
  }
}
