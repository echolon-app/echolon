import { StoredMock } from './types';

/**
 * In-memory store for mocks per namespace
 */
export class MockStore {
  // namespace -> mocks
  private store: Map<string, StoredMock[]> = new Map();

  /**
   * Get all mocks for a namespace
   */
  getMocks(namespace: string): StoredMock[] {
    return this.store.get(namespace) || [];
  }

  /**
   * Set all mocks for a namespace (replace)
   */
  setMocks(namespace: string, mocks: StoredMock[]): void {
    this.store.set(namespace, mocks);
    console.log(`[MockStore] Set ${mocks.length} mocks for namespace: ${namespace}`);
  }

  /**
   * Add or update a single mock
   */
  upsertMock(namespace: string, mock: StoredMock): void {
    const mocks = this.getMocks(namespace);
    const existingIndex = mocks.findIndex(m => m.id === mock.id);
    
    if (existingIndex >= 0) {
      mocks[existingIndex] = { ...mock, updatedAt: Date.now() };
      console.log(`[MockStore] Updated mock ${mock.id} for namespace: ${namespace}`);
    } else {
      mocks.push({ ...mock, createdAt: Date.now(), updatedAt: Date.now() });
      console.log(`[MockStore] Added mock ${mock.id} for namespace: ${namespace}`);
    }
    
    this.store.set(namespace, mocks);
  }

  /**
   * Delete a mock by ID
   */
  deleteMock(namespace: string, mockId: string): boolean {
    const mocks = this.getMocks(namespace);
    const index = mocks.findIndex(m => m.id === mockId);
    
    if (index >= 0) {
      mocks.splice(index, 1);
      this.store.set(namespace, mocks);
      console.log(`[MockStore] Deleted mock ${mockId} from namespace: ${namespace}`);
      return true;
    }
    
    return false;
  }

  /**
   * Find a matching mock for a request
   */
  findMock(namespace: string, method: string, path: string): StoredMock | undefined {
    const mocks = this.getMocks(namespace);
    
    return mocks.find(mock => {
      if (!mock.enabled) return false;
      if (mock.method !== method) return false;
      
      // Exact match
      if (mock.path === path) return true;
      
      // Pattern match with :param
      const mockParts = mock.path.split('/');
      const pathParts = path.split('/');
      
      if (mockParts.length !== pathParts.length) return false;
      
      return mockParts.every((part, i) => {
        if (part.startsWith(':')) return true; // Wildcard param
        return part === pathParts[i];
      });
    });
  }

  /**
   * Clear all mocks for a namespace
   */
  clearMocks(namespace: string): void {
    this.store.delete(namespace);
    console.log(`[MockStore] Cleared all mocks for namespace: ${namespace}`);
  }

  /**
   * Get all namespaces with mocks
   */
  getNamespaces(): string[] {
    return Array.from(this.store.keys());
  }
}

export const mockStore = new MockStore();
export default mockStore;

