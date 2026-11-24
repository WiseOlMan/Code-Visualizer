/** Reindex command. */
export function main() {
  return reindexCatalog();
}

/** Rebuilds the active catalog rows. */
export function reindexCatalog() {
  return prisma.catalog.findMany({ where: { active: true } });
}
