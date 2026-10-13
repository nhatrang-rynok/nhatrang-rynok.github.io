// Ссылки на WhatsApp и Telegram с атрибутом data-app. На телефоне открываем приложение сразу (whatsapp://, tg://):
// обычные wa.me и t.me сначала грузят страницу в браузере, предлагают скачать приложение и только потом открывают его.
// Если приложение не открылось (его нет на телефоне), через полторы секунды открываем обычную ссылку.
const MOBILE = /Android|iPhone|iPad|iPod/i;
const FALLBACK_MS = 1500;

export function initAppLinks() {
  document.addEventListener('click', e => {
    const link = e.target?.closest?.('a[data-app]');
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (!MOBILE.test(navigator.userAgent)) return; // на компьютере работает обычная ссылка
    e.preventDefault();
    let left = false;
    const leave = () => { left = true; };
    document.addEventListener('visibilitychange', leave, { once: true });
    window.addEventListener('pagehide', leave, { once: true });
    window.addEventListener('blur', leave, { once: true });
    location.href = link.dataset.app;
    setTimeout(() => {
      document.removeEventListener('visibilitychange', leave);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('blur', leave);
      if (!left && !document.hidden) window.open(link.href, '_blank', 'noopener');
    }, FALLBACK_MS);
  });
}
