// Electron uses a narrow native write API because browser clipboard permissions
// are disabled for the app. Browser previews keep using the Web Clipboard API.
export async function copyText(text: string): Promise<void> {
  if (window.mygamepack?.clipboardWriteText) {
    await window.mygamepack.clipboardWriteText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
