// These tests specify future browser-independent boundaries. No game modules
// exist yet. Missing modules deliberately fail instead of silently skipping.
export async function loadContract(name) {
  const url = new URL(`../../src/foundation/${name}.mjs`, import.meta.url);
  try {
    return await import(url.href);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === url.href) {
      throw new Error(`Foundation contract not implemented yet: src/foundation/${name}.mjs`, { cause: error });
    }
    throw error;
  }
}
