/* "Add to home screen": uses the native prompt when the browser offers it, instructions otherwise. */
(function () {
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
    const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ready = () => {
        const btn = document.getElementById('install-btn');
        if (!btn) return;
        if (standalone() || location.protocol === 'file:') { btn.closest('p').style.display = 'none'; return; }
        btn.addEventListener('click', async () => {
            if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; return; }
            const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
            alert(ios
                ? 'در آیفون/آیپد (Safari):\n۱) دکمهٔ اشتراک‌گذاری (Share) را بزنید\n۲) «Add to Home Screen» را انتخاب کنید\n۳) Add را بزنید'
                : 'در منوی مرورگر (⋮) گزینهٔ «Install app» یا «Add to Home screen» را بزنید.\nبعد از یک بار باز شدن با اینترنت، برنامه آفلاین هم کار می‌کند.');
        });
    };
    window.addEventListener('appinstalled', () => { document.getElementById('install-btn')?.closest('p')?.setAttribute('style', 'display:none'); });
    document.addEventListener('DOMContentLoaded', ready);
})();
