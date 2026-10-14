import { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { api } from '../lib/api.js';
import { encryptItem, decryptItem, toHex } from '../lib/crypto.js';

const VaultContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case 'SYNC_START':
      return { ...state, syncing: true, syncError: null };
    case 'SYNC_SUCCESS': {
      const itemMap = new Map(state.items);
      for (const item of action.items) {
        itemMap.set(item._id, item);
      }
      const folderMap = new Map(state.folders);
      for (const folder of action.folders) {
        folderMap.set(folder._id, folder);
      }
      return {
        ...state,
        syncing: false,
        items: itemMap,
        folders: folderMap,
        lastSyncedAt: action.serverTime || new Date().toISOString(),
      };
    }
    case 'SYNC_FAIL':
      return { ...state, syncing: false, syncError: action.error };
    case 'ITEM_SET': {
      const items = new Map(state.items);
      items.set(action.item._id, action.item);
      return { ...state, items };
    }
    case 'ITEM_REMOVE': {
      const items = new Map(state.items);
      items.delete(action.id);
      return { ...state, items };
    }
    case 'TRASH_PURGED': {
      const items = new Map();
      for (const [id, item] of state.items.entries()) {
        if (!item.deletedAt) {
          items.set(id, item);
        }
      }
      return { ...state, items };
    }
    case 'FOLDER_SET': {
      const folders = new Map(state.folders);
      folders.set(action.folder._id, action.folder);
      return { ...state, folders };
    }
    case 'FOLDER_REMOVE': {
      const folders = new Map(state.folders);
      folders.delete(action.id);
      return { ...state, folders };
    }
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

const INITIAL_STATE = {
  items: new Map(), // Map<id, decryptedItem>
  folders: new Map(), // Map<id, decryptedFolder>
  syncing: false,
  syncError: null,
  lastSyncedAt: null,
};

export function VaultProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { status, user, accessToken, vaultKeyRef } = useAuth();

  // Clear vault memory on logout or lock
  useEffect(() => {
    if (status === 'locked' || status === 'unauthenticated') {
      dispatch({ type: 'RESET' });
    }
  }, [status]);

  /**
   * Sync items and folders from server and decrypt in memory
   */
  const syncVault = useCallback(async () => {
    if (status !== 'unlocked' || !vaultKeyRef.current || !user) {
      return;
    }

    dispatch({ type: 'SYNC_START' });

    try {
      const query = state.lastSyncedAt ? `?since=${encodeURIComponent(state.lastSyncedAt)}` : '';
      const data = await api(`/api/v1/vault/sync${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const decryptedItems = [];
      for (const it of data.items || []) {
        try {
          const plain = await decryptItem(
            { iv: it.iv, ct: it.ct },
            vaultKeyRef.current,
            user.id,
            it._id
          );
          decryptedItems.push({
            ...it,
            ...plain,
            decrypted: true,
          });
        } catch (err) {
          // VLT-09: Failed decrypt shows a warning on that item and never crashes the list
          decryptedItems.push({
            ...it,
            name: 'Decryption Error (Corrupted or Tampered)',
            type: 'login',
            decrypted: false,
            error: err.message || 'Ciphertext or AAD verification failed',
          });
        }
      }

      const decryptedFolders = [];
      for (const fol of data.folders || []) {
        try {
          const plain = await decryptItem(
            { iv: fol.iv, ct: fol.ct },
            vaultKeyRef.current,
            user.id,
            fol._id
          );
          decryptedFolders.push({
            ...fol,
            ...plain,
            decrypted: true,
          });
        } catch {
          decryptedFolders.push({
            ...fol,
            name: 'Encrypted Folder',
            decrypted: false,
          });
        }
      }

      dispatch({
        type: 'SYNC_SUCCESS',
        items: decryptedItems,
        folders: decryptedFolders,
        serverTime: data.serverTime,
      });
    } catch (err) {
      dispatch({ type: 'SYNC_FAIL', error: err.message || 'Sync failed' });
    }
  }, [status, user, accessToken, vaultKeyRef, state.lastSyncedAt]);

  // Initial sync once unlocked
  useEffect(() => {
    if (status === 'unlocked' && vaultKeyRef.current && user) {
      syncVault();
    }
  }, [status, syncVault]);

  /**
   * Create an item in the vault
   */
  const createItem = useCallback(
    async (itemData) => {
      if (!vaultKeyRef.current || !user) throw new Error('Vault is locked');

      // Client pre-generates 24-hex ObjectId for AAD binding
      const itemId = toHex(crypto.getRandomValues(new Uint8Array(12)));
      const now = new Date().toISOString();

      const blobToEncrypt = {
        v: 1,
        ...itemData,
        createdAt: now,
        updatedAt: now,
      };

      const { iv, ct } = await encryptItem(blobToEncrypt, vaultKeyRef.current, user.id, itemId);

      const res = await api('/api/v1/vault/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { _id: itemId, iv, ct },
      });

      const fullDecrypted = {
        ...res.item,
        ...blobToEncrypt,
        decrypted: true,
      };

      dispatch({ type: 'ITEM_SET', item: fullDecrypted });
      return fullDecrypted;
    },
    [user, accessToken, vaultKeyRef]
  );

  /**
   * Update an existing item (with optimistic concurrency check)
   */
  const updateItem = useCallback(
    async (itemId, itemData, currentRev) => {
      if (!vaultKeyRef.current || !user) throw new Error('Vault is locked');

      const now = new Date().toISOString();
      const blobToEncrypt = {
        v: 1,
        ...itemData,
        updatedAt: now,
      };

      const { iv, ct } = await encryptItem(blobToEncrypt, vaultKeyRef.current, user.id, itemId);

      try {
        const res = await api(`/api/v1/vault/items/${itemId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'If-Match': currentRev.toString(),
          },
          body: { iv, ct },
        });

        const fullDecrypted = {
          ...res.item,
          ...blobToEncrypt,
          decrypted: true,
        };

        dispatch({ type: 'ITEM_SET', item: fullDecrypted });
        return { success: true, item: fullDecrypted };
      } catch (err) {
        if (err.status === 409 || err.data?.error?.code === 'CONFLICT') {
          return {
            conflict: true,
            serverItem: err.data?.error?.currentItem,
            message: 'Item has been modified elsewhere',
          };
        }
        throw err;
      }
    },
    [user, accessToken, vaultKeyRef]
  );

  /**
   * Soft delete (move to trash)
   */
  const trashItem = useCallback(
    async (itemId) => {
      if (!accessToken) return;
      const res = await api(`/api/v1/vault/items/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const existing = state.items.get(itemId);
      if (existing) {
        dispatch({
          type: 'ITEM_SET',
          item: {
            ...existing,
            ...res.item,
            deletedAt: res.item.deletedAt,
            purgeAt: res.item.purgeAt,
          },
        });
      }
    },
    [accessToken, state.items]
  );

  /**
   * Restore an item from trash
   */
  const restoreItem = useCallback(
    async (itemId) => {
      if (!accessToken) return;
      const res = await api(`/api/v1/vault/items/${itemId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const existing = state.items.get(itemId);
      if (existing) {
        dispatch({
          type: 'ITEM_SET',
          item: {
            ...existing,
            ...res.item,
            deletedAt: null,
            purgeAt: null,
          },
        });
      }
    },
    [accessToken, state.items]
  );

  /**
   * Permanent delete
   */
  const permanentDeleteItem = useCallback(
    async (itemId) => {
      if (!accessToken) return;
      await api(`/api/v1/vault/items/${itemId}/permanent`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      dispatch({ type: 'ITEM_REMOVE', id: itemId });
    },
    [accessToken]
  );

  /**
   * Empty trash
   */
  const emptyTrash = useCallback(async () => {
    if (!accessToken) return;
    await api('/api/v1/vault/trash', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    dispatch({ type: 'TRASH_PURGED' });
  }, [accessToken]);

  /**
   * Create folder
   */
  const createFolder = useCallback(
    async (folderName, color = '') => {
      if (!vaultKeyRef.current || !user) throw new Error('Vault is locked');
      const folderId = toHex(crypto.getRandomValues(new Uint8Array(12)));
      const blob = { name: folderName, color };
      const { iv, ct } = await encryptItem(blob, vaultKeyRef.current, user.id, folderId);

      const res = await api('/api/v1/vault/folders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { _id: folderId, iv, ct },
      });

      const folderDecrypted = {
        ...res.folder,
        ...blob,
        decrypted: true,
      };
      dispatch({ type: 'FOLDER_SET', folder: folderDecrypted });
      return folderDecrypted;
    },
    [user, accessToken, vaultKeyRef]
  );

  /**
   * Delete folder
   */
  const deleteFolder = useCallback(
    async (folderId) => {
      if (!accessToken) return;
      await api(`/api/v1/vault/folders/${folderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      dispatch({ type: 'FOLDER_REMOVE', id: folderId });
    },
    [accessToken]
  );

  const value = {
    items: Array.from(state.items.values()),
    folders: Array.from(state.folders.values()),
    syncing: state.syncing,
    syncError: state.syncError,
    lastSyncedAt: state.lastSyncedAt,
    syncVault,
    createItem,
    updateItem,
    trashItem,
    restoreItem,
    permanentDeleteItem,
    emptyTrash,
    createFolder,
    deleteFolder,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
}
