/**
 * content-local.js — gửi DOM về fk-skills local server khi đang ở localhost
 *
 * Chỉ chạy trên localhost/* — manifest.json giới hạn matches.
 * Khi server chưa chạy, fetch sẽ fail silently.
 */

const FK_SERVER = 'http://localhost:3001';
let debounceTimer = null;

async function sendDOM() {
  try {
    await fetch(FK_SERVER + '/api/dom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: location.href,
        html: document.documentElement.outerHTML,
      }),
    });
  } catch {
    // Server chưa chạy hoặc không phản hồi — bỏ qua
  }
}

// Gửi ngay sau khi DOM idle
sendDOM();

// Gửi lại khi SPA navigate (DOM thay đổi lớn)
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendDOM, 800);
});

observer.observe(document.body, { childList: true, subtree: true });
