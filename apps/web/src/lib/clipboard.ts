/**
 * Clipboard write that also works outside secure contexts (plain http over
 * a VPN IP), where navigator.clipboard is undefined.
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy is not available in this browser.');
    }
  } finally {
    area.remove();
  }
}
