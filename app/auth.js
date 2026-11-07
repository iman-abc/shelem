/* Login, user management (admin) and per-user server sync. Works offline after the first login. */
(function () {
    const cfg = window.SHELEM_CONFIG || {};
    const configured = !!(cfg.supabaseUrl && cfg.anonKey);
    const SESSION_KEY = 'shelem-session';
    const $ = (s, r = document) => r.querySelector(s);
    const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

    let session = configured ? readJSON(SESSION_KEY) : null;
    // Each user gets their own saved games on this device.
    window.SHELEM_STORAGE_KEY = (configured && session) ? 'shelem-app-state:' + session.username : 'shelem-app-state';

    // ---------- server calls ----------
    const ERR = {
        invalid_credentials: 'نام کاربری یا رمز اشتباه است', unauthorized: 'نشست شما منقضی شده است',
        forbidden: 'دسترسی ندارید', username_taken: 'این نام کاربری قبلاً ثبت شده است',
        username_too_short: 'نام کاربری باید حداقل ۳ حرف باشد', password_too_short: 'رمز باید حداقل ۶ حرف باشد',
        cannot_disable_self: 'نمی‌توانید خودتان را غیرفعال کنید', network: 'اتصال به اینترنت/سرور برقرار نیست',
    };
    const rpc = async (fn, args = {}) => {
        let res;
        try {
            res = await fetch(`${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json', apikey: cfg.anonKey }, cfg.anonKey.startsWith('eyJ') ? { Authorization: 'Bearer ' + cfg.anonKey } : {}),
                body: JSON.stringify(args),
            });
        } catch { const e = new Error(ERR.network); e.code = 'network'; throw e; }
        const text = await res.text();
        let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok) {
            const msg = (body && (body.message || body.hint || '')) || '';
            const code = Object.keys(ERR).find(c => msg.includes(c)) || 'server';
            const e = new Error(ERR[code] || ('خطای سرور: ' + (msg || res.status))); e.code = code; throw e;
        }
        return body;
    };
    const tok = () => session && session.token;

    // ---------- overlay UI ----------
    let overlay = null;
    const close = () => { overlay?.remove(); overlay = null; document.body.style.overflow = ''; };
    const dialog = (html, dismissible = true) => {
        close();
        overlay = document.createElement('div');
        overlay.className = 'lock-overlay';
        overlay.innerHTML = `<div class="lock-box">${html}${dismissible ? '<button data-x>بستن</button>' : ''}</div>`;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        $('[data-x]', overlay)?.addEventListener('click', close);
        return overlay;
    };
    const setErr = (el, m) => { $('.lock-err', el).textContent = m || ''; };
    const busy = (btn, on) => { btn.disabled = on; btn.style.opacity = on ? .6 : 1; };

    const showLogin = (note) => {
        const el = dialog(`
            <h2>ورود به شلم</h2><p>${note || 'با نام کاربری و رمز خود وارد شوید'}</p>
            <input id="lg-u" placeholder="نام کاربری" autocomplete="username" autocapitalize="off" dir="ltr">
            <input id="lg-p" type="password" placeholder="رمز عبور" autocomplete="current-password" dir="ltr">
            <div class="lock-err"></div>
            <button class="primary" id="lg-go">ورود</button>`, false);
        const go = async () => {
            const u = $('#lg-u', el).value.trim(), p = $('#lg-p', el).value;
            if (!u || !p) return setErr(el, 'نام کاربری و رمز را وارد کنید');
            const b = $('#lg-go', el); busy(b, true); setErr(el, '');
            try {
                const r = await rpc('app_login', { p_username: u, p_password: p });
                // first login on this device: adopt games saved before accounts existed
                const key = 'shelem-app-state:' + r.username;
                if (!localStorage.getItem(key) && !localStorage.getItem('shelem-adopted') && localStorage.getItem('shelem-app-state')) {
                    localStorage.setItem(key, localStorage.getItem('shelem-app-state'));
                    localStorage.setItem('shelem-adopted', r.username);
                }
                localStorage.setItem(SESSION_KEY, JSON.stringify({ token: r.token, username: r.username, is_admin: r.is_admin }));
                location.reload();
            } catch (e) { setErr(el, e.message); busy(b, false); }
        };
        $('#lg-go', el).addEventListener('click', go);
        el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        setTimeout(() => $('#lg-u', el)?.focus(), 50);
    };

    const logout = async () => {
        try { if (navigator.onLine) await rpc('app_logout', { p_token: tok() }); } catch {}
        localStorage.removeItem(SESSION_KEY);
        location.reload();
    };

    const showChangePassword = () => {
        const el = dialog(`<h2>تغییر رمز</h2>
            <input id="cp-o" type="password" placeholder="رمز فعلی" dir="ltr">
            <input id="cp-n" type="password" placeholder="رمز جدید (حداقل ۶ حرف)" dir="ltr">
            <div class="lock-err"></div><button class="primary" id="cp-go">ذخیره</button>`);
        $('#cp-go', el).addEventListener('click', async () => {
            const b = $('#cp-go', el); busy(b, true);
            try { await rpc('app_change_password', { p_token: tok(), p_old: $('#cp-o', el).value, p_new: $('#cp-n', el).value }); showMenu('رمز تغییر کرد ✓'); }
            catch (e) { setErr(el, e.message); busy(b, false); }
        });
    };

    const showUsers = async () => {
        const el = dialog(`<h2>مدیریت کاربران</h2><div id="u-list" style="text-align:right;font-size:.9rem">در حال بارگذاری…</div>
            <hr style="border:0;border-top:1px solid var(--border-color);margin:.8rem 0">
            <p style="margin-bottom:.4rem"><b>ساخت کاربر جدید</b></p>
            <input id="nu-u" placeholder="نام کاربری" dir="ltr" autocapitalize="off">
            <input id="nu-p" type="text" placeholder="رمز (حداقل ۶ حرف)" dir="ltr">
            <label style="display:block;font-size:.85rem;margin:.2rem 0 .4rem"><input type="checkbox" id="nu-a" style="width:auto;margin-left:.4rem">مدیر باشد</label>
            <div class="lock-err"></div><button class="primary" id="nu-go">ساخت کاربر</button>`);
        const load = async () => {
            try {
                const users = await rpc('app_list_users', { p_token: tok() });
                $('#u-list', el).innerHTML = users.map(u => `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:.4rem;padding:.35rem 0;border-bottom:1px solid var(--border-color)">
                        <span>${u.username}${u.is_admin ? ' <small>(مدیر)</small>' : ''}${u.disabled ? ' <small style="color:var(--danger-color)">غیرفعال</small>' : ''}
                        <small style="color:var(--text-muted)"> · ${u.games} بازی</small></span>
                        <span style="display:flex;gap:.3rem">
                            <button data-reset="${u.username}" style="width:auto;padding:.25rem .6rem;margin:0;font-size:.75rem">رمز</button>
                            ${u.username === session.username ? '' : `<button data-dis="${u.username}" data-v="${!u.disabled}" style="width:auto;padding:.25rem .6rem;margin:0;font-size:.75rem">${u.disabled ? 'فعال' : 'غیرفعال'}</button>`}
                        </span></div>`).join('');
            } catch (e) { $('#u-list', el).textContent = e.message; }
        };
        el.addEventListener('click', async (ev) => {
            const r = ev.target.closest('[data-reset]'), d = ev.target.closest('[data-dis]');
            try {
                if (r) { const np = prompt('رمز جدید برای ' + r.dataset.reset + ' (حداقل ۶ حرف):'); if (np) { await rpc('app_admin_reset_password', { p_token: tok(), p_username: r.dataset.reset, p_new: np }); alert('رمز تغییر کرد'); } }
                if (d) { await rpc('app_set_disabled', { p_token: tok(), p_username: d.dataset.dis, p_disabled: d.dataset.v === 'true' }); load(); }
            } catch (e) { setErr(el, e.message); }
        });
        $('#nu-go', el).addEventListener('click', async () => {
            const b = $('#nu-go', el); busy(b, true); setErr(el, '');
            try {
                await rpc('app_create_user', { p_token: tok(), p_username: $('#nu-u', el).value, p_password: $('#nu-p', el).value, p_is_admin: $('#nu-a', el).checked });
                $('#nu-u', el).value = ''; $('#nu-p', el).value = ''; await load();
            } catch (e) { setErr(el, e.message); }
            busy(b, false);
        });
        load();
    };

    const STATUS_TEXT = { ok: 'همگام‌سازی شد ✓', syncing: 'در حال همگام‌سازی…', pending: 'تغییرات در انتظار ارسال', offline: 'آفلاین — پس از اتصال همگام می‌شود', error: 'خطا در همگام‌سازی', local: 'حالت محلی' };
    const showMenu = (note) => {
        if (!configured) {
            return dialog(`<h2>حالت محلی</h2><p>سرور تنظیم نشده است؛ اطلاعات فقط روی همین دستگاه ذخیره می‌شود و ورود لازم نیست.</p>`);
        }
        const el = dialog(`<h2>${session.username}${session.is_admin ? ' <small>(مدیر)</small>' : ''}</h2>
            <p>${note || STATUS_TEXT[syncState] || ''}</p>
            <button id="m-sync">همگام‌سازی اکنون</button>
            <button id="m-pw">تغییر رمز</button>
            ${session.is_admin ? '<button id="m-users">مدیریت کاربران</button>' : ''}
            <button class="danger" id="m-out">خروج از حساب</button>`);
        $('#m-sync', el).addEventListener('click', () => { sync.run(); close(); });
        $('#m-pw', el).addEventListener('click', showChangePassword);
        $('#m-users', el)?.addEventListener('click', () => navigator.onLine ? showUsers() : setErr(el, ERR.network) || alert(ERR.network));
        $('#m-out', el).addEventListener('click', () => { if (confirm('خروج از حساب؟ بازی‌های همگام‌شده روی سرور می‌مانند.')) logout(); });
    };

    // ---------- sync ----------
    let syncState = configured ? 'pending' : 'local';
    const setState = (s) => { syncState = s; $('#user-btn')?.setAttribute('data-sync', s); };
    const hashOf = (o) => { const s = JSON.stringify(o); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
    const sync = (() => {
        let timer = null, running = false, again = false;
        const key = () => 'shelem-sync:' + session.username;
        const getH = () => (readJSON(key()) || {}).hashes || {};
        const putH = (h) => localStorage.setItem(key(), JSON.stringify({ hashes: h }));
        const bridge = () => window.ShelemBridge;

        const run = async () => {
            if (!configured || !session || !bridge()) return;
            if (!navigator.onLine) return setState('offline');
            if (running) { again = true; return; }
            running = true; setState('syncing');
            try {
                const hashes = getH();
                // 1) pull + merge
                const rows = await rpc('app_list_games', { p_token: tok() });
                let games = bridge().getGames().slice(), changedLocal = false;
                for (const row of rows) {
                    const i = games.findIndex(g => g.id === row.game_id), local = i >= 0 ? games[i] : null;
                    const localUnchanged = local && hashes[row.game_id] === hashOf(local);
                    if (row.deleted) {
                        if (local && localUnchanged) { games.splice(i, 1); changedLocal = true; delete hashes[row.game_id]; }
                        else if (!local) delete hashes[row.game_id];
                    } else if (!local) {
                        games.push(row.data); hashes[row.game_id] = hashOf(row.data); changedLocal = true;
                    } else if (localUnchanged) {
                        if (hashOf(row.data) !== hashOf(local)) { games[i] = row.data; changedLocal = true; }
                        hashes[row.game_id] = hashOf(row.data);
                    } else if (hashes[row.game_id] === undefined && (row.data.lastActivity || 0) > (local.lastActivity || 0)) {
                        games[i] = row.data; hashes[row.game_id] = hashOf(row.data); changedLocal = true;
                    } // else: local has newer unsynced edits -> keep, will push
                }
                if (changedLocal) bridge().setGames(games);
                // 2) push local changes
                games = bridge().getGames();
                const up = games.filter(g => hashes[g.id] !== hashOf(g)).map(g => ({ game_id: g.id, data: g, updated_at: Date.now(), deleted: false }));
                const gone = Object.keys(hashes).filter(id => !games.some(g => g.id === id)).map(id => ({ game_id: id, data: null, updated_at: Date.now(), deleted: true }));
                if (up.length || gone.length) {
                    await rpc('app_save_games', { p_token: tok(), p_games: [...up, ...gone] });
                    up.forEach(u => { hashes[u.game_id] = hashOf(u.data); });
                    gone.forEach(g => { delete hashes[g.game_id]; });
                }
                putH(hashes);
                setState('ok');
            } catch (e) {
                if (e.code === 'unauthorized') { localStorage.removeItem(SESSION_KEY); location.reload(); return; }
                setState(e.code === 'network' ? 'offline' : 'error'); console.warn('sync failed', e);
            } finally { running = false; if (again) { again = false; setTimeout(run, 300); } }
        };
        const notify = () => { if (!configured || !session) return; setState(navigator.onLine ? 'pending' : 'offline'); clearTimeout(timer); timer = setTimeout(run, 1500); };
        return { run, notify };
    })();
    window.ShelemSync = { notify: sync.notify, run: sync.run };

    // ---------- start ----------
    const userBtn = $('#user-btn');
    userBtn?.addEventListener('click', () => showMenu());
    if (userBtn) userBtn.setAttribute('data-sync', syncState);

    if (configured) {
        if (!session) {
            showLogin(navigator.onLine ? '' : 'برای اولین ورود باید به اینترنت وصل باشید');
            window.addEventListener('online', () => { if (!session && $('#lg-u')) $('.lock-box p').textContent = 'با نام کاربری و رمز خود وارد شوید'; });
        } else {
            window.addEventListener('DOMContentLoaded', () => setTimeout(sync.run, 300));
            window.addEventListener('online', () => sync.run());
            document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.run(); });
            setInterval(() => { if (!document.hidden) sync.run(); }, 90 * 1000);
            if (navigator.onLine) rpc('app_me', { p_token: tok() }).then(me => { session.is_admin = me.is_admin; }).catch(e => { if (e.code === 'unauthorized') { localStorage.removeItem(SESSION_KEY); location.reload(); } });
        }
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
