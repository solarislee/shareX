// Service worker: fetches cross-origin images (twimg.com) and returns them as
// data URLs. Content scripts can't reliably do cross-origin fetches in MV3,
// but the service worker can (via host_permissions), and a data URL drawn onto
// a canvas never taints it.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "fetchImage") {
    fetch(msg.url, { credentials: "omit" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      })
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          })
      )
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for async sendResponse
  }
});
