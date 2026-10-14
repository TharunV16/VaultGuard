// @ts-check

let activeClearTimer = null;

/**
 * Copy text to clipboard and schedule auto-clear after specified seconds.
 * Best-effort basis (browser permission allowing readText).
 * @param {string} text
 * @param {number} [clearAfterSec=30]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function copyToClipboard(text, clearAfterSec = 30) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    return { success: false, message: 'Clipboard not supported in this browser' };
  }

  try {
    await navigator.clipboard.writeText(text);

    if (activeClearTimer) {
      clearTimeout(activeClearTimer);
    }

    if (clearAfterSec > 0) {
      activeClearTimer = setTimeout(async () => {
        try {
          // Verify if clipboard still holds the sensitive copied value before clearing
          if (navigator.clipboard.readText) {
            const current = await navigator.clipboard.readText();
            if (current === text) {
              await navigator.clipboard.writeText('');
            }
          }
        } catch {
          // Ignore read permissions failure on timeout
        }
      }, clearAfterSec * 1000);
    }

    return { success: true, message: `Copied! Clears in ${clearAfterSec}s` };
  } catch (err) {
    return { success: false, message: 'Failed to copy to clipboard' };
  }
}
