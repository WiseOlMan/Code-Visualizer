/** Reindex command. */
export function main() {
  return reindexCatalog();
}

export function reindexCatalog() {
  return prisma.catalog.findMany({});
}
