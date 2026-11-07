/* App lock (optional password) + persistent local storage.
   NOTE: this is a screen lock for casual access on a shared device. Game data stays in this
   browser's localStorage and is not encrypted. */
(function () {
    const LOCK_KEY = 'shelem-lock';
    const SESSION_KEY = 'shelem-unlocked';
    const AUTO_LOCK_MS = 5 * 60 * 1000;
    const hasCrypto = !!(window.crypto && crypto.subtle);
    const enc = new TextEncoder();
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

    const derive = async (password, saltBytes, iter) => {
        const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' }, key, 256));
    };
    const getLock = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)); } catch { return null; } };
    const setPassword = async (pw) => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iter = 150000;
        localStorage.setItem(LOCK_KEY, JSON.stringify({ salt: b64(salt), iter, hash: await derive(pw, salt, iter) }));
    };
    const verify = async (pw) => {
        const l = getLock();
        if (!l) return true;
        return (await derive(pw, unb64(l.salt), l.iter)) === l.hash;
    };

    // ---- overlay dialog helper ----
    let overlay = null;
    const closeOverlay = () => { overlay?.remove(); overlay = null; document.body.style.overflow = ''; };
    const dialog = (html, { dismissible = true } = {}) => {
        closeOverlay();
        overlay = document.createElement('div');
        overlay.className = 'lock-overlay';
        overlay.innerHTML = `<div class="lock-box">${html}${dismissible ? '<button data-x>انصراف</button>' : ''}</div>`;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        overlay.querySelector('[data-x]')?.addEventListener('click', closeOverlay);
        return overlay;
    };
    const err = (el, msg) => { el.querySelector('.lock-err').textContent = msg; };

    // ---- screens ----
    const showUnlock = () => {
        const el = dialog(`
            <h2>🔒 برنامه قفل است</h2><p>رمز عبور را وارد کنید</p>
            <input type="password" id="lk-pw" autocomplete="current-password" autofocus>
            <div class="lock-err"></div>
            <button class="primary" id="lk-ok">ورود</button>
            <button class="danger" id="lk-reset">رمز را فراموش کرده‌ام (پاک‌کردن همهٔ اطلاعات)</button>`, { dismissible: false });
        const go = async () => {
            const pw = el.querySelector('#lk-pw').value;
            if (await verify(pw)) { sessionStorage.setItem(SESSION_KEY, '1'); closeOverlay(); }
            else { err(el, 'رمز اشتباه است'); el.querySelector('#lk-pw').select(); }
        };
        el.querySelector('#lk-ok').addEventListener('click', go);
        el.querySelector('#lk-pw').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        el.querySelector('#lk-reset').addEventListener('click', () => {
            if (confirm('همهٔ بازی‌ها و رمز پاک می‌شود و قابل بازگشت نیست. ادامه می‌دهید؟')) {
                localStorage.removeItem('shelem-app-state');
                localStorage.removeItem(LOCK_KEY);
                sessionStorage.removeItem(SESSION_KEY);
                location.reload();
            }
        });
        setTimeout(() => el.querySelector('#lk-pw')?.focus(), 50);
    };

    const showSet = (changing) => {
        const el = dialog(`
            <h2>${changing ? 'تغییر رمز' : 'تعیین رمز عبور'}</h2>
            <p>رمز هنگام باز کردن برنامه پرسیده می‌شود. اگر فراموش شود، فقط با پاک‌کردن اطلاعات می‌توان وارد شد.</p>
            ${changing ? '<input type="password" id="lk-old" placeholder="رمز فعلی" autocomplete="current-password">' : ''}
            <input type="password" id="lk-new" placeholder="رمز جدید (حداقل ۴ حرف)" autocomplete="new-password">
            <input type="password" id="lk-new2" placeholder="تکرار رمز جدید" autocomplete="new-password">
            <div class="lock-err"></div>
            <button class="primary" id="lk-save">ذخیره</button>`);
        el.querySelector('#lk-save').addEventListener('click', async () => {
            const nw = el.querySelector('#lk-new').value;
            if (changing && !(await verify(el.querySelector('#lk-old').value))) return err(el, 'رمز فعلی اشتباه است');
            if (nw.length < 4) return err(el, 'رمز باید حداقل ۴ حرف باشد');
            if (nw !== el.querySelector('#lk-new2').value) return err(el, 'تکرار رمز یکسان نیست');
            await setPassword(nw);
            sessionStorage.setItem(SESSION_KEY, '1');
            closeOverlay(); refreshBtn();
        });
    };

    const showManage = () => {
        const el = dialog(`
            <h2>قفل برنامه فعال است</h2><p>اطلاعات شما فقط روی همین دستگاه ذخیره می‌شود.</p>
            <button id="lk-now">قفل کن</button>
            <button id="lk-change">تغییر رمز</button>
            <button class="danger" id="lk-remove">حذف رمز</button>`);
        el.querySelector('#lk-now').addEventListener('click', () => { sessionStorage.removeItem(SESSION_KEY); showUnlock(); });
        el.querySelector('#lk-change').addEventListener('click', () => showSet(true));
        el.querySelector('#lk-remove').addEventListener('click', () => {
            const e2 = dialog(`<h2>حذف رمز</h2><p>رمز فعلی را وارد کنید</p>
                <input type="password" id="lk-old"><div class="lock-err"></div>
                <button class="primary" id="lk-rm">حذف رمز</button>`);
            e2.querySelector('#lk-rm').addEventListener('click', async () => {
                if (!(await verify(e2.querySelector('#lk-old').value))) return err(e2, 'رمز اشتباه است');
                localStorage.removeItem(LOCK_KEY); closeOverlay(); refreshBtn();
            });
        });
    };

    const btn = document.getElementById('lock-btn');
    const refreshBtn = () => { btn?.classList.toggle('on', !!getLock()); };
    btn?.addEventListener('click', () => {
        if (!hasCrypto) return alert('قفل برنامه در این مرورگر/آدرس پشتیبانی نمی‌شود (نیاز به HTTPS).');
        getLock() ? showManage() : showSet(false);
    });
    refreshBtn();

    // Lock on open, and after the app has been in the background for a while
    const needsUnlock = () => !!getLock() && !sessionStorage.getItem(SESSION_KEY);
    if (hasCrypto && needsUnlock()) showUnlock();
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { hiddenAt = Date.now(); return; }
        if (hasCrypto && getLock() && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) {
            sessionStorage.removeItem(SESSION_KEY); showUnlock();
        }
    });

    // Ask the browser not to evict our data under storage pressure
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
