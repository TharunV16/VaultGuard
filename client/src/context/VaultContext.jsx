import { createContext, useContext, useReducer, useCallback } from 'react';

const VaultContext = createContext(null);

// Vault state: { items: Map<id,decryptedItem>, folders: Map<id,decryptedFolder>, loading, error, lastSync }
function reducer(state, action) {
  switch (action.type) {
    case 'SYNC_START':
      return { ...state, loading: true, error: null };
    case 'SYNC_DONE':
      return { ...state, loading: false, items: action.items, folders: action.folders, lastSync: action.at };
    case 'SYNC_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'ITEM_UPSERT': {
      const items = new Map(state.items);
      items.set(action.item.id, action.item);
      return { ...state, items };
    }
    case 'ITEM_REMOVE': {
      const items = new Map(state.items);
      items.delete(action.id);
      return { ...state, items };
    }
    case 'FOLDER_UPSERT': {
      const folders = new Map(state.folders);
      folders.set(action.folder.id, action.folder);
      return { ...state, folders };
    }
    case 'FOLDER_REMOVE': {
      const folders = new Map(state.folders);
      folders.delete(action.id);
      return { ...state, folders };
    }
    case 'CLEAR':
      return INITIAL_STATE;
    default:
      return state;
  }
}

const INITIAL_STATE = {
  items: new Map(),
  folders: new Map(),
  loading: false,
  error: null,
  lastSync: null,
};

export function VaultProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);
  return (
    <VaultContext.Provider value={{ ...state, dispatch, clear }}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
}
