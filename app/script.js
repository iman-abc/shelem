document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    const DEFAULT_PLAYERS = ['Iman', 'Sanaz', 'Reza', 'Hanieh', 'Sahar', 'Hosein', 'Saeid', 'Roya', 'Mahsa'];
    const OLD_DEFAULT_PLAYERS = ['میلاد', 'فاطمه', 'امیرحسین', 'فهیمه', 'محمد', 'مسعود', 'یاسمن', 'نیلا', 'زهرا', 'سمن', 'هانیه', 'حلما', 'نسرین', 'فرشته', 'عباس'];
    // Capitalize the first letter of Latin names (iman -> Iman); Persian names are untouched
    const normalizeName = (n) => (n || '').trim().replace(/\s+/g, ' ').replace(/^[a-z]/, c => c.toUpperCase());
    let state = {
        modalStack: [], // For nested modals
        history: [], // Simple view stack
        games: [],
        activeGameId: null,
        recentPlayers: [...DEFAULT_PLAYERS],
    };

    moment.locale('fa');

    const STORAGE_KEY = window.SHELEM_STORAGE_KEY || 'shelem-app-state';
    const db = {
        persist: () => {
            try {
                const { history, modalStack, ...stateToSave } = state;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
            } catch (e) {
                console.error("Error saving to localStorage", e);
            }
        },
        save: () => { db.persist(); window.ShelemSync && window.ShelemSync.notify(); },
        load: () => {
            const savedState = localStorage.getItem(STORAGE_KEY);
            if (savedState) {
                try {
                    const parsedState = JSON.parse(savedState);
                    if (parsedState && Array.isArray(parsedState.games)) {
                        state = { ...state, ...parsedState };
                    }
                    // drop the old built-in suggestions, make sure the new ones exist
                    const mine = (state.recentPlayers || []).filter(n => !OLD_DEFAULT_PLAYERS.includes(n)).map(normalizeName);
                    state.recentPlayers = [...new Set([...mine, ...DEFAULT_PLAYERS])].slice(0, 20);
                } catch (e) {
                    console.error("Error parsing state from localStorage", e);
                }
            }
        }
    };

    // Admin read-only copies of other users' games (never saved / synced)
    let viewGames = [];
    const findGame = (id) => state.games.find(g => g.id === id) || viewGames.find(g => g.id === id);

    // Bridge used by auth.js to merge games coming from the server
    window.ShelemBridge = {
        getGames: () => state.games,
        showAdminGames: (rows) => showAdminGamesModal(rows),
        setGames: (games) => {
            reopenStaleFinished(games);
            state.games = games;
            db.persist();
            const cur = state.history[state.history.length - 1];
            if (!cur || cur.page === 'home-page') renderHomePage();
            else if (cur.page === 'game-page' && cur.context && !state.games.some(g => g.id === cur.context.gameId)) { state.history = [{ page: 'home-page', context: null }]; updateUI('home-page'); }
        },
    };

    // --- THEME ---
    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('shelem-theme', next);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#171a22' : '#4f46e5');
        const cur = state.history[state.history.length - 1];
        if (cur && cur.page === 'game-page' && cur.context) renderGamePage(cur.context.gameId);
    });

    // --- DOM ELEMENTS ---
    const mainContent = document.getElementById('main-content');
    const pages = document.querySelectorAll('.page');
    const modalContainer = document.getElementById('modal-container');
    const modalContent = document.querySelector('.modal-content');
    const backButton = document.getElementById('back-button');
    const appHeader = document.getElementById('app-header');

    // --- BADGE DATA ---
    const badgeData = {
        // Hakem Badges
        shelem_kar: { name: 'شلم‌کار', description: 'حاکمی که توانسته حداقل یک بار شلم کند.', type: 'hakem', permanent: true },
        shelem_kar_azam: { name: 'شلم‌کار اعظم', description: 'حاکمی که در مجموع دست‌هایی که شلم کرده، بیشترین امتیاز را برای تیمش گرفته است. (این نشان فقط در صورتی اهدا می‌شود که بیش از یک نفر نشان «شلم‌کار» را داشته باشند.)', type: 'hakem' },
        manfi_khor: { name: 'منفی‌خور', description: 'حاکمی که حداقل یک بار منفی خورده است.', type: 'hakem', permanent: true },
        manfi_khor_azam: { name: 'منفی‌خور اعظم', description: 'حاکمی که در مجموع دست‌هایی که منفی خورده بیشترین امتیاز منفی را گرفته است. (این نشان فقط در صورتی اهدا می‌شود که بیش از یک نفر نشان «منفی‌خور» را داشته باشند.)', type: 'hakem' },
        yasa_khor: { name: 'یاساخور', description: 'حاکمی که حداقل یک بار یاسا شده است.', type: 'hakem', permanent: true },
        yasa_khor_azam: { name: 'یاساخور اعظم', description: 'حاکمی که در زمان‌های یاسا خوردن بیشترین امتیاز منفی را گرفته. (این نشان فقط در صورتی اهدا می‌شود که بیش از یک نفر نشان «یاساخور» را داشته باشند.)', type: 'hakem' },
        agha_balatar: { name: 'آقا بالاتر', description: 'کسی که در بین دست‌های موفق، بیشترین امتیاز را تعهد کرده. (به شرط تعهد بالای ۱۳۰ و منحصر به فرد بودن)', type: 'hakem' },
        gonde_gooz_azam: { name: 'گنده‌گوز اعظم', description: 'تنها حاکمی که در بین دست‌های ناموفق بالاترین تعهد را داشته و تعهدش از ۱۳۵ بیشتر بوده است.', type: 'hakem' },
        khoshshans_milimetri: { name: 'خوش‌شانس میلی‌متری', description: 'کسی که در میانگین دفعاتی که حکومت موفق داشته با کمترین اختلاف (کمتر از ۱۰) نسبت به مقدار تعهد خود برنده شده است.', type: 'hakem' },
        mazad_chi: { name: 'مازادچی', description: 'کسی که در میانگین دفعاتی که حکومت موفق داشته با بیشترین اختلاف (بیشتر از ۳۰) نسبت به مقدار تعهد خود برنده شده.', type: 'hakem' },
        badshans_milimetri: { name: 'بدشانس میلی‌متری', description: 'کسی که در میانگین دفعاتی که حکومت ناموفق داشته با کمترین اختلاف (کمتر از ۱۰) نسبت به مقدار تعهد خود بازنده شده.', type: 'hakem' },
        doshman_shad_kon: { name: 'دشمن‌شادکن', description: 'کسی که در مجموع دفعاتی که حاکم بوده، بیشتر از اینکه برای تیمش سود داشته باشد، ضرر زده است.', type: 'hakem' },
        del_chi: { name: 'دل‌چی', description: 'برای هر کس که بیش از ۳ بار حاکم شده و بیش از نصف دفعاتی که حاکم شده خال دل را حکم کرده است.', type: 'hakem' },
        gishniz_chi: { name: 'گشنیزچی', description: 'برای هر کس که بیش از ۳ بار حاکم شده و حداقل نصف دفعاتی که حاکم شده خال گشنیز را حکم کرده است.', type: 'hakem' },
        pik_chi: { name: 'پیک‌چی', description: 'برای هر کس که بیش از ۳ بار حاکم شده و حداقل نصف دفعاتی که حاکم شده خال پیک را حکم کرده است.', type: 'hakem' },
        khesht_chi: { name: 'خشت‌چی', description: 'برای هر کس که بیش از ۳ بار حاکم شده و حداقل نصف دفعاتی که حاکم شده خال خشت را حکم کرده است.', type: 'hakem' },
        soltan_hearts: { name: 'سلطان ♥', description: 'کسی که بیشتر از حاکمان دیگر (و حداقل ۳ بار) خال دل را به عنوان حکم انتخاب کرده است.', type: 'hakem' },
        soltan_spades: { name: 'سلطان ♠', description: 'کسی که بیشتر از حاکمان دیگر (و حداقل ۳ بار) خال پیک را به عنوان حکم انتخاب کرده است.', type: 'hakem' },
        soltan_clubs: { name: 'سلطان ♣', description: 'کسی که بیشتر از حاکمان دیگر (و حداقل ۳ بار) خال گشنیز را به عنوان حکم انتخاب کرده است.', type: 'hakem' },
        soltan_diamonds: { name: 'سلطان ♦', description: 'کسی که بیشتر از حاکمان دیگر (و حداقل ۳ بار) خال خشت را به عنوان حکم انتخاب کرده است.', type: 'hakem' },
        nim_soltan_hearts: { name: 'نیم‌سلطان ♥', description: 'به همراه دیگران، بیشترین تعداد حکم دل را (حداقل ۳ بار) داشته است.', type: 'hakem' },
        nim_soltan_spades: { name: 'نیم‌سلطان ♠', description: 'به همراه دیگران، بیشترین تعداد حکم پیک را (حداقل ۳ بار) داشته است.', type: 'hakem' },
        nim_soltan_clubs: { name: 'نیم‌سلطان ♣', description: 'به همراه دیگران، بیشترین تعداد حکم گشنیز را (حداقل ۳ بار) داشته است.', type: 'hakem' },
        nim_soltan_diamonds: { name: 'نیم‌سلطان ♦', description: 'به همراه دیگران، بیشترین تعداد حکم خشت را (حداقل ۳ بار) داشته است.', type: 'hakem' },
        super_hakem: { name: 'سوپر حاکم', description: 'کسی که حداقل سه بار حاکم بوده و در مجموع دفعاتی که حاکم شده بیشترین امتیاز را گرفته است.', type: 'hakem' },
        super_manfi_khor: { name: 'سوپر منفی‌خور', description: 'کسی که حداقل سه بار حاکم بوده و در مجموع کمترین امتیاز (منفی) را کسب کرده است.', type: 'hakem' },
        // Dealer Badges
        dast_tala: { name: 'دست طلا', description: 'تنها کسی که حداقل سه بار دست داده و در مجموع تفاضل امتیاز تیمش از حریف مثبت و بیشترین بوده است.', type: 'dealer' },
        dast_siah: { name: 'دست‌سیاه', description: 'تنها کسی که حداقل سه بار دست داده و در مجموع تفاضل امتیاز تیمش از حریف منفی و کمترین بوده است.', type: 'dealer' },
        // Team Badges
        be_khodet_bia: { name: 'به خودت بیا!', description: 'تیمی که امتیازش از تیم حریف کمتر است و اختلاف امتیازها بیشتر از ۳۵ درصد هدف بازی است.', type: 'team' },
        shoma_mitoonid: { name: 'شما می‌تونید!', description: 'تیمی که قبلا نشان «به خودت بیا» داشته، اما حالا فاصله‌اش با حریف کم شده.', type: 'team' },
        bazgasht_ghahremanane: { name: 'بازگشت قهرمانانه', description: 'تیمی که قبلا عقب بوده اما الان از حریف جلو افتاده است.', type: 'team', permanent: true },
    };

    // --- HELPERS ---
    const toPersianDigits = (str) => {
        if (str === null || str === undefined) return '';
        const persian = { '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹' };
        return String(str).replace(/[0-9]/g, (w) => persian[w]).replace(/-([۰-۹][۰-۹.٫]*)/g, '\u202A-$1\u202C');
    };
    const generateUUID = () => crypto.randomUUID();

    // --- NAVIGATION & HISTORY MANAGEMENT ---
    const updateUI = (pageId, context) => {
        pages.forEach(p => p.classList.remove('active'));
        const page = document.getElementById(pageId);
        if (page) {
            page.classList.add('active');
        }

        if (pageId === 'home-page') {
            renderHomePage();
            backButton.classList.add('hidden');
            document.getElementById('footer-menu').style.display = 'flex';
        } else {
            backButton.classList.remove('hidden');
            document.getElementById('footer-menu').style.display = 'none';
        }

        if (pageId === 'game-page' && context && context.gameId) renderGamePage(context.gameId);
        if (pageId === 'history-page' && context && context.gameId) renderHistoryPage(context.gameId);
    };

    const navigateTo = (pageId, context = null) => {
        state.history.push({ page: pageId, context });
        updateUI(pageId, context);
        window.scrollTo(0, 0);
    };

    backButton.addEventListener('click', () => {
        if (state.history.length > 1) {
            state.history.pop();
            const previousView = state.history[state.history.length - 1];
            updateUI(previousView.page, previousView.context);
        }
    });

    // --- MODAL MANAGEMENT ---
    const openModal = (htmlContent, onOpen) => {
        modalContent.innerHTML = htmlContent;
        modalContainer.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (onOpen) onOpen();
    };

    const closeModal = () => {
        const previousHTML = state.modalStack.pop();
        if (previousHTML) {
            modalContent.innerHTML = previousHTML;
        } else {
            modalContainer.classList.add('hidden');
            document.body.style.overflow = 'auto';
            modalContent.innerHTML = '';
        }
    };

    modalContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay') || e.target.closest('.modal-close-btn')) {
            closeModal();
        }
    });

    // --- DATE & TIME HELPERS ---
    const getPersianDateWithDay = (timestamp) => {
        return `${moment(timestamp).format('dddd jD jMMMM jYYYY')}`;
    };
     const getPersianDateTime = (timestamp) => {
        return toPersianDigits(moment(timestamp).format('dddd jD jMMMM jYYYY [ساعت] HH:mm'));
    };

    const getRelativeTimeWithDay = (timestamp) => {
        const now = moment();
        const date = moment(timestamp);
        const diffDays = now.startOf('day').diff(date.startOf('day'), 'days');
        const dayName = `(${moment(timestamp).format('dddd')})`;

        if (diffDays < 1 && now.isSame(date, 'day')) return `امروز ${dayName}`;
        if (diffDays === 1) return `دیروز ${dayName}`;
        if (diffDays < 10) return `${toPersianDigits(diffDays)} روز پیش ${dayName}`;
        return getPersianDateWithDay(timestamp);
    };
    
    // --- BADGE RENDERING ---
    const renderBadges = (badges, type) => {
        if (!badges || badges.length === 0) return '';
        return badges.map(badgeId => {
            const badge = badgeData[badgeId];
            if (!badge) return '';
            return `<span class="badge-chip badge-${type}" data-badge-id="${badgeId}">${badge.name}</span>`;
        }).join('');
    };

    const renderRulesBadges = () => {
        const container = document.getElementById('badges-list-in-rules');
        if (!container) return;

        let html = '<div class="badges-rules-grid">';
        for (const badgeId in badgeData) {
            const badge = badgeData[badgeId];
            html += `
                <div class="badge-rule-item">
                    <span class="badge-chip badge-${badge.type}" data-badge-id="${badgeId}">${badge.name}</span>
                    <p>${badge.description}</p>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    };


    // --- RENDERING FUNCTIONS ---
    const renderHomePage = () => {
        const gamesListContainer = document.getElementById('games-list-container');
        const noGamesPlaceholder = document.getElementById('no-games-placeholder');
        gamesListContainer.innerHTML = '';

        if (!state.games || state.games.length === 0) {
            noGamesPlaceholder.style.display = 'block';
        } else {
            noGamesPlaceholder.style.display = 'none';
            const sortedGames = [...state.games].sort((a, b) => b.lastActivity - a.lastActivity);

            sortedGames.forEach(game => {
                const team1Score = game.hands.reduce((acc, hand) => acc + hand.scores.team1, 0);
                const team2Score = game.hands.reduce((acc, hand) => acc + hand.scores.team2, 0);
                const progress1 = Math.max(0, Math.min(100, (team1Score / game.targetScore) * 100));
                const progress2 = Math.max(0, Math.min(100, (team2Score / game.targetScore) * 100));

                const card = document.createElement('div');
                card.className = `game-card ${game.isFinished ? 'finished' : ''}`;
                card.dataset.gameId = game.id;
                card.innerHTML = `
                    <div class="card-header">
                        <div>
                            <span class="game-title">${game.name}</span>
                            ${game.isFinished ? '<span class="game-status">پایان یافته</span>' : ''}
                        </div>
                        <button class="delete-game-btn" data-game-id="${game.id}">
                           <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                    <div class="card-body">
                        <div class="card-meta">
                            <div class="meta-item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                <span>ایجاد: ${getRelativeTimeWithDay(game.createdAt)}</span>
                            </div>
                            <div class="meta-item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.94 18.94a10 10 0 1 1 1.41-1.41l3.32 3.32a1 1 0 0 1-1.41 1.41zM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"></path></svg>
                                <span>هدف: <span class="score-value">${toPersianDigits(game.targetScore)}</span> امتیاز</span>
                            </div>
                        </div>
                        <div class="team-score-card">
                            <div class="team-info">
                                <span class="team-names">${game.players.p1} و ${game.players.p3}</span>
                                <span class="team-score score-value ${team1Score < 0 ? 'negative' : ''}">${toPersianDigits(team1Score)}</span>
                            </div>
                            <div class="score-progress"><div class="progress-bar" style="width: ${progress1}%;"></div></div>
                        </div>
                        <div class="team-score-card">
                            <div class="team-info">
                                <span class="team-names">${game.players.p2} و ${game.players.p4}</span>
                                <span class="team-score score-value ${team2Score < 0 ? 'negative' : ''}">${toPersianDigits(team2Score)}</span>
                            </div>
                             <div class="score-progress"><div class="progress-bar" style="width: ${progress2}%;"></div></div>
                        </div>
                    </div>
                    <div class="card-footer">
                        <div class="meta-item">
                           <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                           <span>${toPersianDigits(game.hands.length)} دست بازی شده</span>
                        </div>
                         <div class="meta-item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span>آخرین فعالیت: ${getRelativeTimeWithDay(game.lastActivity)}</span>
                        </div>
                    </div>
                `;
                card.addEventListener('click', (e) => {
                    if (!e.target.closest('.delete-game-btn')) {
                        state.activeGameId = game.id;
                        navigateTo('game-page', { gameId: game.id });
                    }
                });
                gamesListContainer.appendChild(card);
            });
        }
    };
    
    const renderGamePage = (gameId) => {
        const game = findGame(gameId);
        if (!game) {
            navigateTo('home-page');
            return;
        }

        const gamePage = document.getElementById('game-page');
        gamePage.classList.toggle('readonly-view', !!game._readOnly);
        document.getElementById('history-page').classList.toggle('readonly-view', !!game._readOnly);
        const team1Score = game.hands.reduce((acc, hand) => acc + hand.scores.team1, 0);
        const team2Score = game.hands.reduce((acc, hand) => acc + hand.scores.team2, 0);
        const remaining1 = game.targetScore - team1Score;
        const remaining2 = game.targetScore - team2Score;
        const currentHand = game.currentHand;
        
        const team1Badges = game.badges?.teams?.team1 || [];
        const team2Badges = game.badges?.teams?.team2 || [];
        
        let currentHandHTML = '';
        if (game.isFinished) {
            let winnerTeam, winnerScore, loserTeam, loserScore;
            if (team1Score > team2Score) {
                winnerTeam = getTeamPlayers(game, 'team1').map(p => game.players[p]).join(' و ');
                winnerScore = team1Score;
                loserTeam = getTeamPlayers(game, 'team2').map(p => game.players[p]).join(' و ');
                loserScore = team2Score;
            } else {
                winnerTeam = getTeamPlayers(game, 'team2').map(p => game.players[p]).join(' و ');
                winnerScore = team2Score;
                loserTeam = getTeamPlayers(game, 'team1').map(p => game.players[p]).join(' و ');
                loserScore = team1Score;
            }
    
            const diff = winnerScore - loserScore;
            const diffPercent = diff / game.targetScore;
            let verb = 'شکست دادند';
            if (diffPercent > 0.35) {
                verb = 'مقتدرانه شکست دادند';
            } else if (diffPercent < 0.10) {
                verb = 'میلی‌متری شکست دادند';
            }
    
            currentHandHTML = `
                <div class="current-hand-box">
                    <p style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">بازی تمام شده</p>
                    <p style="font-size: 1rem; font-weight: normal; line-height: 1.8;">
                        ${winnerTeam} با امتیاز <span class="score-value">${toPersianDigits(winnerScore)}</span> بر <span class="score-value">${toPersianDigits(loserScore)}</span> ${loserTeam} را ${verb}.
                        ${game.finishReason === 'gap' ? '<br><small>(اختلاف امتیاز به سقف بازی رسید)</small>' : ''}
                    </p>
                </div>
            `;
        } else if (currentHand) {
            const nonHakemTeamPlayers = getTeamPlayers(game, getOppositeTeam(game, currentHand.hakem)).map(p => game.players[p]);
            const pointsToFail = 165 - currentHand.commitment + 5;
            currentHandHTML = `
                <div class="current-hand-box">
                    <p style="font-size: 1.2rem; font-weight: 500;">
                        <strong>حاکم:</strong> ${game.players[currentHand.hakem]} (<span class="score-value">${toPersianDigits(currentHand.commitment)}</span> امتیاز)
                        ${currentHand.suit ? `<strong>حکم:</strong> <span class="suit">${getSuitSymbol(currentHand.suit)}</span>` : ''}
                        <br>
                        <span style="font-size: 1rem; font-weight: normal;">اگر ${nonHakemTeamPlayers.join(' و ')} <span class="score-value">${toPersianDigits(pointsToFail)}</span> امتیاز بگیرند، حاکم منفی می‌خورد.</span>
                    </p>
                    <div class="btn-group">
                        <button class="btn btn-primary" id="register-score-btn">ثبت امتیاز این دست</button>
                        <button class="btn btn-secondary" id="edit-hand-btn">اصلاح اطلاعات</button>
                    </div>
                </div>
            `;
        } else {
            const nextDealerIndex = game.hands.length % 4;
            const dealerOrder = [game.firstDealer, getNextPlayer(game.firstDealer), getNextPlayer(getNextPlayer(game.firstDealer)), getNextPlayer(getNextPlayer(getNextPlayer(game.firstDealer)))];
            const nextDealer = game.players[dealerOrder[nextDealerIndex]];
            
            let lastHandInfo = '';
            if (game.hands.length > 0) {
                const lastHand = game.hands[game.hands.length - 1];
                const hakemTeam = getTeam(game, lastHand.hakem);
                const opponentTeam = getOppositeTeam(game, lastHand.hakem);
                const hakemPlayers = getTeamPlayers(game, hakemTeam).map(p => game.players[p]);
                const opponentPlayers = getTeamPlayers(game, opponentTeam).map(p => game.players[p]);
                const hakemScore = lastHand.scores[hakemTeam];
                const opponentScore = lastHand.scores[opponentTeam];

                lastHandInfo = `در دست قبل ${opponentPlayers.join(' و ')} <span class="score-value">${toPersianDigits(opponentScore)}</span> امتیاز گرفتند و ${hakemPlayers.join(' و ')} <span class="score-value ${hakemScore < 0 ? 'score-negative' : 'score-positive'}">${toPersianDigits(Math.abs(hakemScore))}</span> امتیاز ${hakemScore < 0 ? 'منفی' : 'مثبت'} گرفتند.`;
            } else {
                lastHandInfo = `بازی تا <span class="score-value">${toPersianDigits(game.targetScore)}</span> امتیاز است.`;
            }

            currentHandHTML = `
                 <div class="current-hand-box">
                    <h3>${lastHandInfo}</h3>
                    <p>نوبت ${nextDealer} است که کارت‌ها را پخش کند.</p>
                    <button class="btn btn-primary" id="start-new-hand-btn">شروع دست جدید</button>
                </div>
            `;
        }

        gamePage.innerHTML = `
            ${game._readOnly ? `<div class="ro-banner">👁 بازی «${game._owner}» · فقط مشاهده</div>` : ''}
            <h2>${game.name}</h2>
            <div class="game-header-info">
                <div class="meta-item">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.94 18.94a10 10 0 1 1 1.41-1.41l3.32 3.32a1 1 0 0 1-1.41 1.41zM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"></path></svg>
                    <span><strong>هدف:</strong> <span class="score-value">${toPersianDigits(game.targetScore)}</span> امتیاز</span>
                    <a href="#" class="details-toggle" style="margin-right: auto;">نمایش جزئیات بیشتر</a>
                </div>
                <div class="extra-details hidden">
                     <div class="meta-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        <span><strong>شروع:</strong> ${getPersianDateTime(game.createdAt)}</span>
                     </div>
                     <div class="meta-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span><strong>آخرین فعالیت:</strong> ${getPersianDateTime(game.lastActivity)}</span>
                     </div>
                     ${game.description ? `<p class="game-description"><strong>توضیحات:</strong> ${game.description}</p>` : ''}
                     <div class="player-setup-grid" style="margin-top: 1.5rem;">
                        <div class="player-btn filled" data-player="p1">${game.players.p1}</div>
                        <div class="player-btn filled" data-player="p2">${game.players.p2}</div>
                        <div class="player-btn filled" data-player="p3">${game.players.p3}</div>
                        <div class="player-btn filled" data-player="p4">${game.players.p4}</div>
                        <div class="table-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                        </div>
                    </div>
                </div>
            </div>
            
            ${currentHandHTML}

            <div class="game-scores-display">
                <div class="team-score-card">
                    <div class="team-info">
                        <div class="team-names-badges">
                            <span class="team-names">${game.players.p1} و ${game.players.p3}</span>
                            <div class="badges-container">${renderBadges(team1Badges, 'team')}</div>
                        </div>
                        <span class="team-score score-value ${team1Score < 0 ? 'negative' : ''}">${toPersianDigits(team1Score)}</span>
                    </div>
                    <div class="points-to-target">${remaining1 > 0 ? `${toPersianDigits(remaining1)} امتیاز تا هدف` : 'به امتیاز هدف رسیده'}</div>
                    <div class="score-progress"><div class="progress-bar" style="width: ${Math.max(0, (team1Score / game.targetScore) * 100)}%;"></div></div>
                </div>
                <div class="team-score-card">
                    <div class="team-info">
                         <div class="team-names-badges">
                            <span class="team-names">${game.players.p2} و ${game.players.p4}</span>
                            <div class="badges-container">${renderBadges(team2Badges, 'team')}</div>
                        </div>
                        <span class="team-score score-value ${team2Score < 0 ? 'negative' : ''}">${toPersianDigits(team2Score)}</span>
                    </div>
                    <div class="points-to-target">${remaining2 > 0 ? `${toPersianDigits(remaining2)} امتیاز تا هدف` : 'به امتیاز هدف رسیده'}</div>
                    <div class="score-progress"><div class="progress-bar" style="width: ${Math.max(0, (team2Score / game.targetScore) * 100)}%;"></div></div>
                </div>
            </div>

            <button class="btn" id="history-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h4"/></svg>
                تاریخچه دست‌ها
            </button>

            <div class="stats-section">
                <h3>آمار کلی بازی</h3>
                <div class="stats-grid">
                    <div class="chart-wrapper full-width-chart">
                         <canvas id="score-chart"></canvas>
                    </div>
                    <div class="chart-wrapper full-width-chart">
                        <canvas id="hand-chart"></canvas>
                    </div>
                    <div class="chart-wrapper">
                        <canvas id="agg-commitment-chart"></canvas>
                    </div>
                    <div class="chart-wrapper">
                        <canvas id="agg-suit-chart"></canvas>
                    </div>
                    <div class="chart-wrapper">
                        <canvas id="agg-hakem-success-chart"></canvas>
                    </div>
                    <div class="chart-wrapper">
                        <canvas id="agg-points-chart"></canvas>
                    </div>
                </div>

                <h3>آمار حاکمان</h3>
                <div id="hakem-stats"></div>
                <h3>آمار پاسورها</h3>
                <div id="dealer-stats"></div>
            </div>
            
            <button class="btn btn-secondary btn-full" id="export-game-btn" style="margin-top: 1rem;">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                دانلود خروجی این بازی
            </button>
        `;
        
        setupCharts(game);
        renderStats(game);

        const startNewHandBtn = document.getElementById('start-new-hand-btn');
        if(startNewHandBtn) startNewHandBtn.addEventListener('click', () => showNewHandModal(gameId, 'hakem'));

        const registerScoreBtn = document.getElementById('register-score-btn');
        if(registerScoreBtn) registerScoreBtn.addEventListener('click', () => showRegisterScoreModal(gameId));
        
        const editHandBtn = document.getElementById('edit-hand-btn');
        if(editHandBtn) editHandBtn.addEventListener('click', () => showNewHandModal(gameId, 'hakem', true));

        document.querySelector('.details-toggle').addEventListener('click', (e) => {
            e.preventDefault();
            const details = document.querySelector('.extra-details');
            details.classList.toggle('hidden');
            e.target.textContent = details.classList.contains('hidden') ? 'نمایش جزئیات بیشتر' : 'نمایش جزئیات کمتر';
        });
        
        document.getElementById('history-btn').addEventListener('click', () => navigateTo('history-page', { gameId }));
        document.getElementById('export-game-btn').addEventListener('click', () => exportSingleGame(gameId));
    };

    const renderHistoryPage = (gameId) => {
        const game = findGame(gameId);
        const historyPage = document.getElementById('history-page');
        let content = `<h2>تاریخچه دست‌ها</h2>`;

        if (game.hands.length === 0) {
            content += `<div class="placeholder"><p>هنوز دستی بازی نشده است.</p></div>`;
        } else {
            game.hands.forEach((hand, index) => {
                const dealerOrder = [game.firstDealer, getNextPlayer(game.firstDealer), getNextPlayer(getNextPlayer(game.firstDealer)), getNextPlayer(getNextPlayer(getNextPlayer(game.firstDealer)))];
                const dealer = game.players[dealerOrder[index % 4]];
                const hakemTeam = getTeam(game, hand.hakem);
                const opponentTeam = getOppositeTeam(game, hand.hakem);
                const hakemScore = hand.scores[hakemTeam];
                const opponentScore = hand.scores[opponentTeam];

                let hakemStatusClass = hakemScore >= 0 ? 'success' : 'fail';
                let cardStatusClass = hakemScore >= 0 ? 'hakem-success' : 'hakem-failed';
                let specialEventText = '';
                
                const isShelem = hand.hakemScore === 165;
                const isYasa = hakemScore < 0 && hand.hakemScore < 85 && hand.commitment < 165;

                const lockNote = hand.lockedZero ? `<div class="lock-note">🔒 امتیاز حریف (${toPersianDigits(hand.nonHakemScore)}) حساب نشد: حریف بالای ${toPersianDigits(lockThreshold(game))} بود و حاکم موفق شد.</div>` : '';
                if (isShelem) {
                    specialEventText = ' (شلم)';
                    cardStatusClass += ' shelem';
                }
                if (isYasa) {
                    specialEventText = ' (یاسا)';
                    cardStatusClass += ' yasa';
                }
                
                let badgeChangesHTML = '';
                if (hand.badgeChanges && hand.badgeChanges.length > 0) {
                    badgeChangesHTML = `
                        <div class="badge-changes-history">
                            <strong>تغییرات نشان‌ها:</strong>
                            <ul>
                                ${hand.badgeChanges.map(change => `<li>${change}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                }

                content += `
                    <div class="hand-card ${cardStatusClass}">
                        <div class="hand-card-header">
                            دست ${toPersianDigits(index + 1)} <span>(پاسور: ${dealer})</span>
                        </div>
                        <div class="hand-card-body">
                            <span><strong>حاکم:</strong> ${game.players[hand.hakem]}</span>
                            <span><strong>تعهد:</strong> <span class="score-value">${toPersianDigits(hand.commitment)}</span></span>
                            ${hand.suit ? `<span><strong>حکم:</strong> <span class="suit">${getSuitSymbol(hand.suit)}</span></span>` : ''}
                        </div>
                        <div class="hand-card-footer">
                            <div class="score-box score-box-hakem ${hakemStatusClass}">
                                امتیاز حاکم: <span class="score-value">${toPersianDigits(hakemScore)}</span>${specialEventText}
                            </div>
                            <div class="score-box score-box-opponent">
                                امتیاز حریف: <span class="score-value">${toPersianDigits(opponentScore)}</span>
                            </div>
                            ${index === game.hands.length - 1 ? `<button class="btn edit-btn" data-hand-index="${index}">ویرایش</button>` : ''}
                        </div>
                        ${lockNote}
                        ${badgeChangesHTML}
                    </div>
                `;
            });
        }
        historyPage.innerHTML = content;
        
        historyPage.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const handIndex = parseInt(e.target.dataset.handIndex);
                showEditHandModal(gameId, handIndex);
            });
        });
    };
    
    // --- CHARTING ---
    const chartInstances = {};
    const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const palette = () => ({
        text: cssVar('--text-color'), muted: cssVar('--text-muted'), grid: cssVar('--chart-grid'),
        surface: cssVar('--surface'), t1: cssVar('--team1-color'), t2: cssVar('--team2-color'),
        ok: cssVar('--success-color'), bad: cssVar('--danger-color'), primary: cssVar('--primary-color'),
    });
    const faNum = v => toPersianDigits(v);
    const isNarrow = () => window.innerWidth < 480;

    const baseOptions = (c, { title, legend = true, stacked = false } = {}) => ({
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 80,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 2, right: 4, left: 0, bottom: 0 } },
        plugins: {
            title: { display: !!title, text: title, color: c.text, font: { size: isNarrow() ? 12 : 14, weight: '600' }, padding: { bottom: 8 } },
            legend: { display: legend, rtl: true, position: 'bottom', labels: { color: c.muted, usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: isNarrow() ? 10 : 12 } } },
            tooltip: { rtl: true, textDirection: 'rtl', titleAlign: 'right', bodyAlign: 'right', backgroundColor: c.surface, titleColor: c.text, bodyColor: c.text, borderColor: c.grid, borderWidth: 1, padding: 10,
                callbacks: { label: (i) => ` ${i.dataset.label}: ${faNum(i.formattedValue.replace(/,/g, ''))}` } },
        },
        scales: {
            x: { stacked, grid: { display: false }, ticks: { color: c.muted, autoSkip: true, maxRotation: 0, maxTicksLimit: isNarrow() ? 6 : 12, font: { size: isNarrow() ? 10 : 12 } } },
            y: { stacked, grid: { color: c.grid }, ticks: { color: c.muted, callback: v => faNum(v), font: { size: isNarrow() ? 10 : 12 } } },
        },
    });

    const mkChart = (id, config) => {
        const el = document.getElementById(id);
        if (!el) return;
        chartInstances[id]?.destroy();
        chartInstances[id] = new Chart(el.getContext('2d'), config);
    };

    const setupCharts = (game) => {
        Object.keys(chartInstances).forEach(k => { chartInstances[k]?.destroy(); delete chartInstances[k]; });
        Chart.defaults.font.family = 'Vazirmatn';
        Chart.defaults.color = cssVar('--text-muted');
        const playerStats = processStats(game);
        createMainScoreChart(game);
        createHandChart(game);
        createAggregateCommitmentChart(playerStats, game);
        createAggregateSuitChart(playerStats, game);
        createAggregateSuccessChart(playerStats, game);
        createAggregatePointsChart(playerStats, game);
    };

    const teamNames = (game) => [`${game.players.p1} و ${game.players.p3}`, `${game.players.p2} و ${game.players.p4}`];

    const createMainScoreChart = (game) => {
        const c = palette();
        const [n1, n2] = teamNames(game);
        const labels = ['۰'], d1 = [0], d2 = [0];
        let t1 = 0, t2 = 0;
        game.hands.forEach((h, i) => { labels.push(faNum(i + 1)); t1 += h.scores.team1; t2 += h.scores.team2; d1.push(t1); d2.push(t2); });
        const maxVal = Math.max(game.targetScore, t1, t2);
        const opts = baseOptions(c, { title: 'روند امتیازات' });
        opts.scales.y.suggestedMax = maxVal * 1.05;
        opts.scales.x.title = { display: true, text: 'شمارهٔ دست', color: c.muted, font: { size: 11 } };
        opts.plugins.annotation = { annotations: {
            zero: { type: 'line', yMin: 0, yMax: 0, borderColor: c.muted, borderWidth: 1 },
            target: { type: 'line', yMin: game.targetScore, yMax: game.targetScore, borderColor: c.bad, borderWidth: 1.5, borderDash: [6, 6],
                label: { display: true, content: `هدف ${faNum(game.targetScore)}`, position: 'start', backgroundColor: 'transparent', color: c.bad, font: { size: 11 }, yAdjust: -10 } },
        } };
        const ds = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2.5, pointRadius: game.hands.length > 20 ? 0 : 3, pointHoverRadius: 5, tension: 0.25, fill: false });
        mkChart('score-chart', { type: 'line', data: { labels, datasets: [ds(n1, d1, c.t1), ds(n2, d2, c.t2)] }, options: opts });
    };

    // Per-hand points for each team: shows momentum and big swings
    const createHandChart = (game) => {
        const c = palette();
        const [n1, n2] = teamNames(game);
        const labels = game.hands.map((_, i) => faNum(i + 1));
        const opts = baseOptions(c, { title: 'امتیاز هر دست' });
        mkChart('hand-chart', { type: 'bar', data: { labels, datasets: [
            { label: n1, data: game.hands.map(h => h.scores.team1), backgroundColor: c.t1, borderRadius: 3 },
            { label: n2, data: game.hands.map(h => h.scores.team2), backgroundColor: c.t2, borderRadius: 3 },
        ] }, options: opts });
    };

    const createStackedBarChart = (canvasId, title, labels, successData, failData) => {
        const c = palette();
        const opts = baseOptions(c, { title, stacked: true });
        opts.scales.y.ticks.stepSize = 1;
        opts.scales.y.beginAtZero = true;
        mkChart(canvasId, { type: 'bar', data: { labels, datasets: [
            { label: 'موفق', data: successData, backgroundColor: c.ok, borderRadius: 3, maxBarThickness: 36 },
            { label: 'ناموفق', data: failData, backgroundColor: c.bad, borderRadius: 3, maxBarThickness: 36 },
        ] }, options: opts });
    };

    const createGroupedBarChart = (canvasId, title, labels, data1, data2, label1, label2) => {
        const c = palette();
        const opts = baseOptions(c, { title });
        mkChart(canvasId, { type: 'bar', data: { labels, datasets: [
            { label: label1, data: data1, backgroundColor: data1.map(v => v >= 0 ? c.ok : c.bad), borderRadius: 3, maxBarThickness: 36 },
            { label: label2, data: data2, backgroundColor: c.primary, borderRadius: 3, maxBarThickness: 36 },
        ] }, options: opts });
    };

    const createAggregateCommitmentChart = (playerStats, game) => {
        const st = {};
        game.hands.forEach(hand => {
            const score = hand.scores[getTeam(game, hand.hakem)];
            st[hand.commitment] = st[hand.commitment] || { s: 0, f: 0 };
            score >= 0 ? st[hand.commitment].s++ : st[hand.commitment].f++;
        });
        const keys = Object.keys(st).sort((a, b) => a - b);
        createStackedBarChart('agg-commitment-chart', 'تعهدها', keys.map(faNum), keys.map(k => st[k].s), keys.map(k => st[k].f));
    };

    const createAggregateSuitChart = (playerStats, game) => {
        const wrapper = document.getElementById('agg-suit-chart')?.closest('.chart-wrapper');
        const order = ['spades', 'hearts', 'diamonds', 'clubs'];
        const st = { spades: { s: 0, f: 0 }, hearts: { s: 0, f: 0 }, diamonds: { s: 0, f: 0 }, clubs: { s: 0, f: 0 } };
        let any = false;
        game.hands.forEach(hand => {
            if (!st[hand.suit]) return;
            any = true;
            hand.scores[getTeam(game, hand.hakem)] >= 0 ? st[hand.suit].s++ : st[hand.suit].f++;
        });
        if (!any) { if (wrapper) wrapper.hidden = true; return; }
        createStackedBarChart('agg-suit-chart', 'حکم‌ها', order.map(getSuitSymbol), order.map(x => st[x].s), order.map(x => st[x].f));
    };

    const createAggregateSuccessChart = (playerStats, game) => {
        const v = Object.values(playerStats);
        createStackedBarChart('agg-hakem-success-chart', 'موفقیت حاکم‌ها', v.map(p => p.name), v.map(p => p.successfulHakem), v.map(p => p.hakemCount - p.successfulHakem));
    };

    const createAggregatePointsChart = (playerStats, game) => {
        const v = Object.values(playerStats);
        createGroupedBarChart('agg-points-chart', 'امتیاز در زمان حکومت', v.map(p => p.name), v.map(p => p.pointsFor), v.map(p => p.pointsAgainst), 'امتیاز گرفته', 'امتیاز داده');
    };

    // --- STATS PROCESSING & RENDERING ---
    const processStats = (game) => {
        const playerStats = {};
        Object.keys(game.players).forEach(pKey => {
            playerStats[pKey] = {
                name: game.players[pKey], hakemCount: 0, successfulHakem: 0, commitments: {},
                suits: { spades: {s:0, f:0}, hearts: {s:0, f:0}, diamonds: {s:0, f:0}, clubs: {s:0, f:0} },
                dealerCommitments: {}, dealerSuits: { spades: {s:0, f:0}, hearts: {s:0, f:0}, diamonds: {s:0, f:0}, clubs: {s:0, f:0} },
                pointsFor: 0, pointsAgainst: 0, shelemCount: 0, yasaCount: 0, deals: 0,
                dealsSuccess: 0, dealsFail: 0, dealsShelem: 0, dealsYasa: 0
            };
        });

        const dealerOrder = [game.firstDealer, getNextPlayer(game.firstDealer), getNextPlayer(getNextPlayer(game.firstDealer)), getNextPlayer(getNextPlayer(getNextPlayer(game.firstDealer)))];
        game.hands.forEach((hand, index) => {
            const dealerKey = dealerOrder[index % 4];
            const hakemKey = hand.hakem;
            const hakemTeam = getTeam(game, hakemKey);
            const hakemScore = hand.scores[hakemTeam];
            const isSuccess = hakemScore >= 0;
            const isShelem = hand.hakemScore === 165;
            const isYasa = hakemScore < 0 && hand.hakemScore < 85 && hand.commitment < 165;

            // Dealer Stats
            playerStats[dealerKey].deals++;
            if (!playerStats[dealerKey].dealerCommitments[hand.commitment]) playerStats[dealerKey].dealerCommitments[hand.commitment] = { s: 0, f: 0 };
            if (isSuccess) {
                playerStats[dealerKey].dealsSuccess++;
                playerStats[dealerKey].dealerCommitments[hand.commitment].s++;
                if (hand.suit) playerStats[dealerKey].dealerSuits[hand.suit].s++;
            } else {
                playerStats[dealerKey].dealsFail++;
                playerStats[dealerKey].dealerCommitments[hand.commitment].f++;
                if (hand.suit) playerStats[dealerKey].dealerSuits[hand.suit].f++;
            }
            if (isShelem) playerStats[dealerKey].dealsShelem++;
            if (isYasa) playerStats[dealerKey].dealsYasa++;

            // Hakem Stats
            playerStats[hakemKey].hakemCount++;
            if (!playerStats[hakemKey].commitments[hand.commitment]) playerStats[hakemKey].commitments[hand.commitment] = { s: 0, f: 0 };
            if (isSuccess) {
                playerStats[hakemKey].successfulHakem++;
                playerStats[hakemKey].commitments[hand.commitment].s++;
                if (hand.suit) playerStats[hakemKey].suits[hand.suit].s++;
            } else {
                playerStats[hakemKey].commitments[hand.commitment].f++;
                if (hand.suit) playerStats[hakemKey].suits[hand.suit].f++;
            }
            playerStats[hakemKey].pointsFor += hakemScore;
            playerStats[hakemKey].pointsAgainst += hand.scores[getOppositeTeam(game, hakemKey)];
            if (isShelem) playerStats[hakemKey].shelemCount++;
            if (isYasa) playerStats[hakemKey].yasaCount++;
        });
        return playerStats;
    };

    const renderStats = (game) => {
        const hakemStatsContainer = document.getElementById('hakem-stats');
        const dealerStatsContainer = document.getElementById('dealer-stats');
        hakemStatsContainer.innerHTML = '';
        dealerStatsContainer.innerHTML = '';
        
        const playerStats = processStats(game);
        const badges = game.badges || {};

        Object.keys(game.players).forEach(pKey => {
            const stats = playerStats[pKey];
            const hakemBadges = badges.hakems?.[pKey] || [];
            const dealerBadges = badges.dealers?.[pKey] || [];

            let hakemCard = '';
            if (stats.hakemCount === 0) {
                hakemCard = `<div class="stat-card"><h4>${stats.name} ${renderBadges(hakemBadges, 'hakem')}</h4><p>هیچ وقت حاکم نبوده.</p></div>`;
            } else {
                 const successRate = Math.round((stats.successfulHakem / stats.hakemCount) * 100);
                let successText = '';
                if (stats.successfulHakem === stats.hakemCount) {
                    successText = `هر ${toPersianDigits(stats.successfulHakem)} بار موفق بوده`;
                } else if (stats.successfulHakem > 0) {
                    successText = `${toPersianDigits(stats.successfulHakem)} بار موفق بوده`;
                }
                if (stats.shelemCount > 0) successText += ` (<span class="special-event success">${toPersianDigits(stats.shelemCount)} بار شلم کرده</span>)`;

                let failText = '';
                const failCount = stats.hakemCount - stats.successfulHakem;
                if (failCount === stats.hakemCount) {
                    failText = `هر ${toPersianDigits(failCount)} بار منفی خورده`;
                } else if (failCount > 0) {
                    failText = `${toPersianDigits(failCount)} بار منفی خورده`;
                }
                if (stats.yasaCount > 0) failText += ` (<span class="special-event fail">${toPersianDigits(stats.yasaCount)} بار یاسا شده</span>)`;

                const allCommits = Object.keys(stats.commitments).map(Number);
                const hakemHands = game.hands.filter(h => h.hakem === pKey);
                const hakemScores = hakemHands.map(h => h.scores[getTeam(game, h.hakem)]);

                hakemCard = `
                    <div class="stat-card">
                        <h4>${stats.name} ${renderBadges(hakemBadges, 'hakem')}</h4>
                        <p>${toPersianDigits(stats.hakemCount)} بار حاکم شده | ${successText} | ${failText} (<span class="${successRate > 60 ? 'success' : 'fail'}">${toPersianDigits(successRate)}٪ موفقیت</span>)</p>
                        <p>امتیازی که تعهد کرده | میانگین: <span class="score-value">${toPersianDigits(Math.round(allCommits.reduce((acc, c) => acc + c * (stats.commitments[c].s + stats.commitments[c].f), 0) / stats.hakemCount / 5) * 5)}</span> | بیشترین: <span class="score-value">${toPersianDigits(Math.max(...allCommits))}</span> | کمترین: <span class="score-value">${toPersianDigits(Math.min(...allCommits))}</span></p>
                        <p>امتیازی که در زمان حکومتش گرفته | میانگین: <span class="score-value">${toPersianDigits(Math.round(stats.pointsFor / stats.hakemCount))}</span> | بیشترین: <span class="score-value">${toPersianDigits(Math.max(...hakemScores))}</span> | کمترین: <span class="score-value">${toPersianDigits(Math.min(...hakemScores))}</span></p>
                        <p>در مجموع زمان‌های حکومتش | <span class="score-value success">${toPersianDigits(stats.pointsFor)}</span> امتیاز گرفته | <span class="score-value fail">${toPersianDigits(stats.pointsAgainst)}</span> امتیاز به تیم حریف داده</p>
                        <div class="individual-stats-grid">
                            <div class="chart-wrapper"><canvas id="hakem-commit-chart-${pKey}"></canvas></div>
                            <div class="chart-wrapper"><canvas id="hakem-suit-chart-${pKey}"></canvas></div>
                        </div>
                    </div>
                `;
            }
            hakemStatsContainer.innerHTML += hakemCard;

            let dealerCard = '';
            if (stats.deals === 0) {
                dealerCard = `<div class="stat-card"><h4>${stats.name} ${renderBadges(dealerBadges, 'dealer')}</h4><p>تا حالا پاسور نبوده است.</p></div>`;
            } else {
                 let dealResultText = ``;
                if(stats.dealsSuccess > 0) dealResultText += `${toPersianDigits(stats.dealsSuccess)} بار موفق بوده‌اند`;
                if(stats.dealsShelem > 0) dealResultText += ` (<span class="special-event success">${toPersianDigits(stats.dealsShelem)} بار شلم کرده‌اند</span>)`;
                if(stats.dealsFail > 0) {
                    if(dealResultText) dealResultText += ' و ';
                    dealResultText += `${toPersianDigits(stats.dealsFail)} بار منفی خورده‌اند`;
                }
                if(stats.dealsYasa > 0) dealResultText += ` (<span class="special-event fail">${toPersianDigits(stats.dealsYasa)} بار یاسا شده‌اند</span>)`;
                
                const allDealerCommits = Object.keys(stats.dealerCommitments).map(Number);

                dealerCard = `
                    <div class="stat-card">
                        <h4>${stats.name} ${renderBadges(dealerBadges, 'dealer')}</h4>
                        <p>${toPersianDigits(stats.deals)} بار پاسور بوده و زمان‌هایی که کارت پخش کرده حاکم‌ها به طور میانگین <span class="score-value">${toPersianDigits(Math.round(allDealerCommits.reduce((acc, c) => acc + c * (stats.dealerCommitments[c].s + stats.dealerCommitments[c].f), 0) / stats.deals / 5) * 5)}</span> امتیاز خوانده‌اند.</p>
                        <p>بیشترین تعهد حاکم در زمان پاسور بودن ${stats.name} <span class="score-value">${toPersianDigits(Math.max(...allDealerCommits))}</span> و کمترین تعهد <span class="score-value">${toPersianDigits(Math.min(...allDealerCommits))}</span> بوده است.</p>
                        <p>وقت‌هایی که ${stats.name} کارت پخش کرده، ${dealResultText}.</p>
                         <div class="individual-stats-grid">
                            <div class="chart-wrapper"><canvas id="dealer-commit-chart-${pKey}"></canvas></div>
                            <div class="chart-wrapper"><canvas id="dealer-suit-chart-${pKey}"></canvas></div>
                        </div>
                    </div>
                `;
            }
            dealerStatsContainer.innerHTML += dealerCard;
        });

        // Render individual charts after they are in the DOM
        Object.keys(game.players).forEach(pKey => {
            const stats = playerStats[pKey];
            if (stats.hakemCount > 0) {
                const commitLabels = Object.keys(stats.commitments).sort((a,b) => a-b).map(c => toPersianDigits(c));
                const commitSuccess = Object.keys(stats.commitments).sort((a,b) => a-b).map(c => stats.commitments[c].s);
                const commitFail = Object.keys(stats.commitments).sort((a,b) => a-b).map(c => stats.commitments[c].f);
                createStackedBarChart(`hakem-commit-chart-${pKey}`, `تعهدها - ${stats.name}`, commitLabels, commitSuccess, commitFail);

                const suitOrder = ['spades', 'hearts', 'diamonds', 'clubs'];
                const suitLabels = suitOrder.map(s => getSuitSymbol(s));
                const suitSuccess = suitOrder.map(s => stats.suits[s].s);
                const suitFail = suitOrder.map(s => stats.suits[s].f);
                if ((suitSuccess.concat(suitFail)).some(Boolean)) createStackedBarChart(`hakem-suit-chart-${pKey}`, `خال حکم - ${stats.name}`, suitLabels, suitSuccess, suitFail);
            }
            if (stats.deals > 0) {
                const commitLabels = Object.keys(stats.dealerCommitments).sort((a,b) => a-b).map(c => toPersianDigits(c));
                const commitSuccess = Object.keys(stats.dealerCommitments).sort((a,b) => a-b).map(c => stats.dealerCommitments[c].s);
                const commitFail = Object.keys(stats.dealerCommitments).sort((a,b) => a-b).map(c => stats.dealerCommitments[c].f);
                createStackedBarChart(`dealer-commit-chart-${pKey}`, `تعهدها در زمان پاسوری - ${stats.name}`, commitLabels, commitSuccess, commitFail);

                const suitOrder = ['spades', 'hearts', 'diamonds', 'clubs'];
                const suitLabels = suitOrder.map(s => getSuitSymbol(s));
                const suitSuccess = suitOrder.map(s => stats.dealerSuits[s].s);
                const suitFail = suitOrder.map(s => stats.dealerSuits[s].f);
                if ((suitSuccess.concat(suitFail)).some(Boolean)) createStackedBarChart(`dealer-suit-chart-${pKey}`, `خال حکم در زمان پاسوری - ${stats.name}`, suitLabels, suitSuccess, suitFail);
            }
        });
        document.querySelectorAll('.individual-stats-grid .chart-wrapper canvas').forEach(cv => {
            if (!chartInstances[cv.id]) cv.closest('.chart-wrapper').hidden = true;
        });
    };

    // --- MODAL CONTENT & LOGIC ---
    const showAdminGamesModal = (rows) => {
        viewGames = rows.filter(r => r.data).map(r => ({ ...r.data, id: `v:${r.owner}:${r.game_id}`, _readOnly: true, _owner: r.owner }));
        const byOwner = {};
        viewGames.forEach(g => (byOwner[g._owner] = byOwner[g._owner] || []).push(g));
        const total = (g, t) => g.hands.reduce((a, h) => a + h.scores[t], 0);
        const owners = Object.keys(byOwner).sort();
        const html = `
            <div class="modal-header"><h2>همهٔ بازی‌ها (مدیر)</h2><button class="modal-close-btn">&times;</button></div>
            <div class="admin-games">
                ${owners.length ? owners.map(o => `
                    <h4>${o} <small>(${toPersianDigits(byOwner[o].length)})</small></h4>
                    ${byOwner[o].map(g => `
                        <button class="grid-btn admin-game-btn" data-vid="${g.id}">
                            <strong>${g.name}</strong>
                            <span>${g.players.p1} و ${g.players.p3} <b>${toPersianDigits(total(g, 'team1'))}</b> — <b>${toPersianDigits(total(g, 'team2'))}</b> ${g.players.p2} و ${g.players.p4}</span>
                            <small>${getRelativeTimeWithDay(g.lastActivity || g.createdAt)}${g.isFinished ? ' · تمام‌شده' : ''}</small>
                        </button>`).join('')}
                `).join('') : '<p class="placeholder">هنوز بازی‌ای روی سرور ثبت نشده است.</p>'}
            </div>`;
        openModal(html, () => {
            document.querySelectorAll('.admin-game-btn').forEach(btn => btn.addEventListener('click', () => {
                closeModal();
                navigateTo('game-page', { gameId: btn.dataset.vid });
            }));
        });
    };

    const showNewGameModal = (step = 1, gameData = {}) => {
        let html = '';
        switch (step) {
            case 1:
                html = `
                    <div class="modal-header">
                        <h2>بازی جدید</h2>
                        <button class="modal-close-btn">&times;</button>
                    </div>
                    <div class="form-group">
                        <label for="game-name">نام بازی (اختیاری)</label>
                        <input type="text" id="game-name" class="form-control" placeholder="مثلا بازی شب یلدا خانه پدربزرگ" value="${gameData.name || ''}">
                    </div>
                    <div class="form-group">
                        <label for="game-desc">توضیحات بازی (اختیاری)</label>
                        <textarea id="game-desc" class="form-control" placeholder="مثلا تیم بازنده باید برای همه بستنی بخرد">${gameData.description || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label>هدف (امتیاز نهایی)</label>
                        <div class="button-grid full-width-4">
                            <button class="grid-btn" data-score="330">۳۳۰</button>
                            <button class="grid-btn" data-score="660">۶۶۰</button>
                            <button class="grid-btn" data-score="1165">۱۱۶۵</button>
                            <button class="grid-btn" data-score="custom">عدد دلخواه</button>
                        </div>
                        <div id="custom-score-wrapper" style="margin-top: 1rem;"></div>
                    </div>
                    <button id="next-step-1" class="btn btn-primary btn-full">ادامه</button>
                `;
                openModal(html, () => {
                    let selectedScore = gameData.targetScore || 1165;
                    const customScoreWrapper = document.getElementById('custom-score-wrapper');
                    
                    const initialSelected = document.querySelector(`.button-grid .grid-btn[data-score="${selectedScore}"]`) || document.querySelector('.button-grid .grid-btn[data-score="1165"]');
                    initialSelected.classList.add('selected');

                    document.querySelectorAll('.button-grid .grid-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            document.querySelector('.button-grid .grid-btn.selected')?.classList.remove('selected');
                            btn.classList.add('selected');
                            
                            if (btn.dataset.score === 'custom') {
                                if (!document.getElementById('custom-score-input')) {
                                    customScoreWrapper.innerHTML = `<input type="number" id="custom-score-input" class="form-control" value="${selectedScore}">`;
                                    document.getElementById('custom-score-input').focus();
                                }
                            } else {
                                selectedScore = parseInt(btn.dataset.score);
                                customScoreWrapper.innerHTML = '';
                            }
                        });
                    });
                    document.getElementById('next-step-1').addEventListener('click', () => {
                        const customInput = document.getElementById('custom-score-input');
                        if (customInput) selectedScore = parseInt(customInput.value) || selectedScore;
                        
                        const newGameData = {
                            ...gameData,
                            name: document.getElementById('game-name').value.trim(),
                            description: document.getElementById('game-desc').value.trim(),
                            targetScore: selectedScore
                        };
                        showNewGameModal(2, newGameData);
                    });
                });
                break;
            
            case 2:
                const players = gameData.players || { p1: '', p2: '', p3: '', p4: '' };
                html = `
                    <div class="modal-header">
                        <h2>انتخاب بازیکنان</h2>
                        <button class="modal-back-btn">&larr;</button>
                    </div>
                    <div class="player-setup-grid">
                        <button class="player-btn ${players.p1 ? 'filled' : ''}" data-player="p1">${players.p1 || 'بازیکن ۱'}</button>
                        <button class="player-btn ${players.p2 ? 'filled' : ''}" data-player="p2">${players.p2 || 'بازیکن ۲'}</button>
                        <button class="player-btn ${players.p3 ? 'filled' : ''}" data-player="p3">${players.p3 || 'بازیکن ۳'}</button>
                        <button class="player-btn ${players.p4 ? 'filled' : ''}" data-player="p4">${players.p4 || 'بازیکن ۴'}</button>
                        <div class="table-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                        </div>
                    </div>
                    <div id="player-name-error" class="error-message"></div>
                    <button id="next-step-2" class="btn btn-primary btn-full" disabled>ادامه</button>
                `;
                openModal(html, () => {
                    const checkAllPlayersEntered = () => {
                        const allEntered = Object.values(players).every(p => p && p.trim() !== '');
                        document.getElementById('next-step-2').disabled = !allEntered;
                    };
                    
                    document.querySelectorAll('.player-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            const playerKey = e.target.dataset.player;
                            showPlayerNameModal(players[playerKey], (newName) => {
                                const updatedPlayers = { ...players, [playerKey]: newName };
                                const newGameData = { ...gameData, players: updatedPlayers };
                                showNewGameModal(2, newGameData);
                            });
                        });
                    });

                    document.querySelector('.modal-back-btn').addEventListener('click', () => {
                        showNewGameModal(1, { ...gameData, players });
                    });

                    document.getElementById('next-step-2').addEventListener('click', () => {
                        const playerNames = Object.values(players);
                        const uniqueNames = new Set(playerNames.map(p => p.trim()));
                        if (uniqueNames.size !== 4) {
                            document.getElementById('player-name-error').textContent = 'نام بازیکنان باید متفاوت باشد.';
                            return;
                        }
                        playerNames.forEach(addRecentPlayer);
                        showNewGameModal(3, { ...gameData, players });
                    });

                    checkAllPlayersEntered();
                });
                break;

            case 3:
                html = `
                    <div class="modal-header">
                        <h2>انتخاب اولین پاسور</h2>
                        <button class="modal-back-btn">&larr;</button>
                    </div>
                    <p>چه کسی اول از همه دست می‌دهد؟</p>
                    <div class="button-grid full-width-4">
                        ${Object.keys(gameData.players).map(pKey => `
                            <button class="grid-btn" data-player="${pKey}">${gameData.players[pKey]}</button>
                        `).join('')}
                    </div>
                `;
                openModal(html, () => {
                    document.querySelectorAll('.button-grid .grid-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const firstDealer = btn.dataset.player;
                            const finalGameData = {
                                ...gameData,
                                firstDealer,
                                id: generateUUID(),
                                createdAt: Date.now(),
                                lastActivity: Date.now(),
                                hands: [],
                                currentHand: null,
                                isFinished: false,
                                badges: {
                                    teams: { team1: [], team2: [] },
                                    hakems: { p1: [], p2: [], p3: [], p4: [] },
                                    dealers: { p1: [], p2: [], p3: [], p4: [] }
                                }
                            };
                            if (!finalGameData.name) {
                                let now = moment();
                                let day = now.format('dddd');
                                let hour = now.hour();
                                let timeOfDay = (hour >= 0 && hour < 5) ? "بامداد" : (hour < 12) ? "صبح" : (hour < 16) ? "ظهر" : (hour < 20) ? "عصر" : "شب";
                                finalGameData.name = `بازی ${day} ${timeOfDay}`;
                            }
                            state.games.push(finalGameData);
                            db.save();
                            closeModal();
                            navigateTo('game-page', { gameId: finalGameData.id });
                        });
                    });
                    document.querySelector('.modal-back-btn').addEventListener('click', () => {
                        showNewGameModal(2, gameData);
                    });
                });
                break;
        }
    };
    
    const showPlayerNameModal = (currentName, callback) => {
        const modalHtml = `
            <div class="modal-header">
                <h2>نام بازیکن</h2>
                <button class="modal-close-btn">&times;</button>
            </div>
            <div class="form-group">
                <input type="text" id="player-name-input" class="form-control" value="${currentName || ''}" placeholder="نام بازیکن را وارد کنید">
            </div>
            <div class="recent-players-list">
                ${state.recentPlayers.map(p => `<button class="grid-btn recent-player-btn">${p}</button>`).join('')}
            </div>
            <button id="confirm-player-name" class="btn btn-primary btn-full">تایید</button>
        `;
        openModal(modalHtml, () => {
            document.querySelectorAll('.recent-player-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const newName = normalizeName(btn.textContent);
                    if (newName) callback(newName);
                });
            });

            document.getElementById('confirm-player-name').addEventListener('click', () => {
                const newName = normalizeName(document.getElementById('player-name-input').value);
                if (newName) callback(newName);
            });
        });
    };
    
    const showNewHandModal = (gameId, step, isEditing = false, handData = {}) => {
        const game = findGame(gameId);
        if (isEditing && Object.keys(handData).length === 0) {
            handData = { ...game.currentHand };
        }
        let html = '';

        switch(step) {
            case 'hakem':
                html = `
                    <div class="modal-header">
                        <h2>${isEditing ? 'اصلاح دست' : 'دست جدید'}: انتخاب حاکم</h2>
                        <button class="modal-close-btn">&times;</button>
                    </div>
                    <div class="button-grid full-width-4">
                        ${Object.keys(game.players).map(pKey => `
                            <button class="grid-btn ${handData.hakem === pKey ? 'selected' : ''}" data-player="${pKey}">${game.players[pKey]}</button>
                        `).join('')}
                    </div>
                `;
                openModal(html, () => {
                    document.querySelectorAll('.button-grid .grid-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            handData.hakem = e.currentTarget.dataset.player;
                            showNewHandModal(gameId, 'commitment', isEditing, handData);
                        });
                    });
                });
                break;

            case 'commitment':
                const commitments = [105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 330, 660];
                html = `
                    <div class="modal-header">
                        <h2>انتخاب تعهد</h2>
                        <button class="modal-back-btn">&larr;</button>
                    </div>
                    <div class="button-grid commitment-grid">
                        ${commitments.map(c => `
                            <button class="grid-btn ${c > 165 ? 'span-2' : ''} ${handData.commitment === c ? 'selected' : ''}" data-commitment="${c}">
                                ${c === 330 ? 'شلم (۳۳۰)' : c === 660 ? 'سرشلم (۶۶۰)' : toPersianDigits(c)}
                            </button>
                        `).join('')}
                    </div>
                `;
                openModal(html, () => {
                     document.querySelectorAll('.button-grid .grid-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            handData.commitment = parseInt(e.currentTarget.dataset.commitment);
                            game.currentHand = handData;
                            game.lastActivity = Date.now();
                            db.save();
                            showRegisterScoreModal(gameId, true);
                        });
                    });
                    document.querySelector('.modal-back-btn').addEventListener('click', () => {
                        showNewHandModal(gameId, 'hakem', isEditing, handData);
                    });
                });
                break;

            case 'suit':
                const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
                html = `
                    <div class="modal-header">
                        <h2>انتخاب حکم</h2>
                        <button class="modal-back-btn">&larr;</button>
                    </div>
                    <div class="button-grid suit-selection full-width-4">
                        ${suits.map(s => `
                            <button class="grid-btn ${handData.suit === s ? 'selected' : ''}" data-suit="${s}">${getSuitSymbol(s)}</button>
                        `).join('')}
                    </div>
                `;
                openModal(html, () => {
                    document.querySelectorAll('.button-grid .grid-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            handData.suit = e.currentTarget.dataset.suit;
                            game.currentHand = handData;
                            game.lastActivity = Date.now();
                            db.save();
                            closeModal();
                            renderGamePage(gameId);
                        });
                    });
                    document.querySelector('.modal-back-btn').addEventListener('click', () => {
                        showNewHandModal(gameId, 'commitment', isEditing, handData);
                    });
                });
                break;
        }
    };

    const showRegisterScoreModal = (gameId, fromFlow = false) => {
        const game = findGame(gameId);
        const hand = game.currentHand;
        const nonHakemTeam = getOppositeTeam(game, hand.hakem);
        const nonHakemPlayers = getTeamPlayers(game, nonHakemTeam).map(p => game.players[p]);
        const failAt = 165 - hand.commitment + 5;
        const commitLabel = hand.commitment === 330 ? 'شلم' : hand.commitment === 660 ? 'سرشلم' : toPersianDigits(hand.commitment);

        let buttons = '';
        for (let i = 0; i <= 160; i += 5) {
            buttons += `<button class="grid-btn" data-score="${i}">${toPersianDigits(i)}</button>`;
        }
        const suitChips = ['spades', 'hearts', 'diamonds', 'clubs'].map(su =>
            `<button class="suit-chip ${hand.suit === su ? 'selected' : ''}" data-suit="${su}">${getSuitSymbol(su)}</button>`).join('');

        const html = `
            <div class="modal-header">
                <h2>امتیاز حریف</h2>
                ${fromFlow ? '<button class="modal-back-btn">&larr;</button>' : '<button class="modal-close-btn">&times;</button>'}
            </div>
            <p class="modal-sub">حاکم: <strong>${game.players[hand.hakem]}</strong> · تعهد: <strong>${commitLabel}</strong></p>
            ${hand.commitment <= 165 ? `<p class="fail-threshold">اگر حریف ${toPersianDigits(failAt)} یا بیشتر بگیرد، حاکم منفی می‌خورد</p>` : ''}
            ${isLocked(game, nonHakemTeam) ? `<p class="fail-threshold" style="color:var(--primary-color)">🔒 تیم حریف بالای ${toPersianDigits(lockThreshold(game))} است؛ امتیازش فقط وقتی حساب می‌شود که حاکم منفی بخورد.</p>` : ''}
            <p class="modal-sub">حکم (اختیاری)</p>
            <div class="suit-chips">${suitChips}</div>
            <p class="modal-sub" style="margin-bottom:.5rem">تیم ${nonHakemPlayers.join(' و ')} چند امتیاز گرفتند؟</p>
            <div class="button-grid full-width-3 score-grid" style="max-height: 260px; overflow-y: auto;">
                ${buttons}
            </div>
        `;

        openModal(html, () => {
            document.querySelectorAll('.suit-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const already = chip.classList.contains('selected');
                    document.querySelectorAll('.suit-chip').forEach(c => c.classList.remove('selected'));
                    if (already) { delete hand.suit; } else { chip.classList.add('selected'); hand.suit = chip.dataset.suit; }
                    db.save();
                });
            });
            document.querySelectorAll('.score-grid .grid-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const nonHakemScore = parseInt(e.currentTarget.dataset.score);
                    closeModal();
                    calculateAndRecordScores(gameId, nonHakemScore);
                });
            });
            const back = document.querySelector('.modal-back-btn');
            if (back) back.addEventListener('click', () => showNewHandModal(gameId, 'commitment', true, { ...hand }));
        });
    };
    
    const showEditHandModal = (gameId, handIndex) => {
        const game = findGame(gameId);
        const hand = game.hands[handIndex];
        const nonHakemTeam = getOppositeTeam(game, hand.hakem);
        const nonHakemPlayers = getTeamPlayers(game, nonHakemTeam).map(p => game.players[p]);
        
        let buttons = '';
        for (let i = 0; i <= 160; i += 5) {
            buttons += `<button class="grid-btn" data-score="${i}">${toPersianDigits(i)}</button>`;
        }

        const html = `
            <div class="modal-header">
                <h2>ویرایش امتیاز دست ${toPersianDigits(handIndex + 1)}</h2>
                <button class="modal-close-btn">&times;</button>
            </div>
            <p>امتیاز جدید تیم ${nonHakemPlayers.join(' و ')} را وارد کنید:</p>
            <div class="button-grid full-width-3" style="max-height: 300px; overflow-y: auto;">
                ${buttons}
            </div>
        `;

        openModal(html, () => {
            document.querySelectorAll('.button-grid .grid-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const score = parseInt(e.currentTarget.dataset.score);
                    const hakemTeam = getTeam(game, hand.hakem);
                    const scores = calculateHandScores(hand.commitment, score, isLocked(game, getOppositeTeam(game, hand.hakem), handIndex));
                    game.hands[handIndex].lockedZero = scores.lockedZero;
                    
                    game.hands[handIndex].scores = {
                        team1: hakemTeam === 'team1' ? scores.hakem : scores.nonHakem,
                        team2: hakemTeam === 'team2' ? scores.hakem : scores.nonHakem,
                    };
                    game.hands[handIndex].nonHakemScore = score;
                    game.hands[handIndex].hakemScore = 165 - score;

                    // Recalculate all badges from scratch
                    let tempGame = { ...game, hands: game.hands.slice(0, handIndex + 1) };
                    tempGame.badges = { teams: { team1: [], team2: [] }, hakems: { p1: [], p2: [], p3: [], p4: [] }, dealers: { p1: [], p2: [], p3: [], p4: [] } };
                    
                    for(let i=0; i< tempGame.hands.length; i++){
                        const {newBadges} = calculateAllBadges(tempGame, i);
                        tempGame.badges = newBadges;
                    }
                    game.badges = tempGame.badges;
                    const fin2 = checkFinished(game);
                    game.isFinished = fin2.finished; game.finishReason = fin2.reason;


                    game.lastActivity = Date.now();
                    db.save();
                    closeModal();
                    renderHistoryPage(gameId);
                    renderGamePage(gameId); // To update main scores
                });
            });
        });
    };
    
    // --- GAME LOGIC ---
    // Team total above this (scaled from 1000 for the 1165 target) is "locked":
    // as the non-hakem team it can only gain points if the opponent hakem fails (manfi).
    const lockThreshold = (game) => Math.floor((1000 * game.targetScore / 1165) / 5) * 5;
    const teamTotalBefore = (game, team, upTo) => game.hands.slice(0, upTo).reduce((acc, h) => acc + h.scores[team], 0);
    const isLocked = (game, team, upTo = game.hands.length) => teamTotalBefore(game, team, upTo) > lockThreshold(game);

    const calculateHandScores = (commitment, nonHakemScore, nonHakemLocked = false) => {
        const hakemScore = 165 - nonHakemScore;
        let finalHakemScore = 0;
        let finalNonHakemScore = nonHakemScore;
        let lockedZero = false;

        if (commitment === 330 && hakemScore === 165) { // Shelem
            finalHakemScore = 330;
            finalNonHakemScore = 0;
        } else if (commitment === 660 && hakemScore === 165) { // SarShelem
            finalHakemScore = 660;
            finalNonHakemScore = 0;
        } else if (hakemScore === 165) { // Unannounced Shelem
            finalHakemScore = commitment * 2;
            finalNonHakemScore = 0;
        } else if (hakemScore >= commitment) { // Successful bid
            finalHakemScore = hakemScore;
            if (nonHakemLocked && nonHakemScore > 0) { finalNonHakemScore = 0; lockedZero = true; }
        } else { // Failed bid (manfi)
            if (hakemScore < 85 && commitment < 165) { // Yasa
                finalHakemScore = -2 * commitment;
            } else {
                finalHakemScore = -commitment;
            }
        }
        return { hakem: finalHakemScore, nonHakem: finalNonHakemScore, lockedZero };
    };

    // Game ends when a team reaches the target OR the gap between the two teams is >= the target (saghf).
    const checkFinished = (game) => {
        const t1 = game.hands.reduce((a, h) => a + h.scores.team1, 0);
        const t2 = game.hands.reduce((a, h) => a + h.scores.team2, 0);
        const reached = t1 >= game.targetScore || t2 >= game.targetScore;
        const gap = Math.abs(t1 - t2) >= game.targetScore;
        return { finished: reached || gap, reason: reached ? 'target' : gap ? 'gap' : null, winner: t1 === t2 ? null : (t1 > t2 ? 'team1' : 'team2') };
    };

    // Games closed by the old "half of target" gap rule are re-opened if they don't meet the current rule.
    const reopenStaleFinished = (games) => {
        let changed = false;
        games.forEach(g => {
            if (g.isFinished && g.finishReason === 'gap' && !checkFinished(g).finished) { g.isFinished = false; delete g.finishReason; changed = true; }
        });
        return changed;
    };

    const calculateAndRecordScores = (gameId, nonHakemScore) => {
        const game = findGame(gameId);
        const currentHand = game.currentHand;
        const hakemTeam = getTeam(game, currentHand.hakem);
        const nonHakemTeam = getOppositeTeam(game, currentHand.hakem);

        const scores = calculateHandScores(currentHand.commitment, nonHakemScore, isLocked(game, nonHakemTeam));

        const handResult = {
            ...currentHand,
            lockedZero: scores.lockedZero,
            hakemScore: 165 - nonHakemScore,
            nonHakemScore: nonHakemScore,
            scores: { team1: 0, team2: 0 }
        };
        handResult.scores[hakemTeam] = scores.hakem;
        handResult.scores[nonHakemTeam] = scores.nonHakem;
        
        const { newBadges, changes } = calculateAllBadges(game, game.hands.length, handResult);
        game.badges = newBadges;
        handResult.badgeChanges = changes;

        game.hands.push(handResult);
        game.currentHand = null;
        game.lastActivity = Date.now();
        
        let winnerShown = false;
        const fin = checkFinished(game);
        if (fin.finished) {
            game.isFinished = true;
            game.finishReason = fin.reason;
            if (fin.winner) {
                const winnerPlayers = getTeamPlayers(game, fin.winner).map(p => game.players[p]);
                winnerShown = true;
                showWinnerModal(winnerPlayers, fin.reason, () => { if (changes.length > 0) showBadgeChangesModal(changes); });
            }
        }

        db.save();
        renderGamePage(gameId);
        
        if (changes.length > 0 && !winnerShown) {
            showBadgeChangesModal(changes);
        }
    };
    
    const showWinnerModal = (winnerPlayers, reason, onDone) => {
        const html = `
            <div class="modal-header">
                <h2>پایان بازی!</h2>
            </div>
            <div class="winner-modal-content">
                <p style="font-size: 3rem;">🎉</p>
                <h2>تبریک به تیم برنده!</h2>
                ${reason === 'gap' ? '<p style="color:var(--text-muted);font-size:.85rem">اختلاف امتیاز به سقف بازی رسید</p>' : ''}
                <p class="team-names">${winnerPlayers.join(' و ')}</p>
                <button id="close-winner-modal" class="btn btn-primary btn-full">بستن</button>
            </div>
        `;
        openModal(html, () => {
            document.getElementById('close-winner-modal').addEventListener('click', () => { closeModal(); if (onDone) onDone(); });
        });
    };

    const addRecentPlayer = (name) => {
        if (!name) return;
        const index = state.recentPlayers.indexOf(name);
        if (index > -1) {
            state.recentPlayers.splice(index, 1);
        }
        state.recentPlayers.unshift(name);
        if (state.recentPlayers.length > 20) {
            state.recentPlayers.pop();
        }
        db.save();
    };

    // --- UTILITY FUNCTIONS ---
    const getTeam = (game, playerKey) => (playerKey === 'p1' || playerKey === 'p3') ? 'team1' : 'team2';
    const getOppositeTeam = (game, playerKey) => (getTeam(game, playerKey) === 'team1') ? 'team2' : 'team1';
    const getTeamPlayers = (game, team) => team === 'team1' ? ['p1', 'p3'] : ['p2', 'p4'];
    const getSuitSymbol = (suit) => ({ spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' })[suit] || '';
    const getNextPlayer = (playerKey) => {
        const order = ['p1', 'p2', 'p3', 'p4'];
        const index = order.indexOf(playerKey);
        return order[(index + 1) % 4];
    };
    
    // --- BADGE LOGIC ---
    const showBadgeChangesModal = (changes) => {
        const html = `
            <div id="badge-changes-modal" class="modal-header">
                <h2>تغییرات نشان‌ها</h2>
                <button class="modal-close-btn">&times;</button>
            </div>
            <ul>
                ${changes.map(change => `<li>${change}</li>`).join('')}
            </ul>
        `;
        openModal(html);
    };

    const calculateAllBadges = (game, currentHandIndex, currentHandResult) => {
        const allHands = currentHandResult ? [...game.hands, currentHandResult] : [...game.hands];
        const oldBadges = JSON.parse(JSON.stringify(game.badges || { teams: { team1: [], team2: [] }, hakems: {p1:[],p2:[],p3:[],p4:[]}, dealers: {p1:[],p2:[],p3:[],p4:[]} }));
        const newBadges = JSON.parse(JSON.stringify(oldBadges));
    
        // --- Helper to manage adding/removing badges ---
        const updatePlayerBadges = (badgeHolder, playerKey, badgeId, condition) => {
            if (!badgeHolder[playerKey]) badgeHolder[playerKey] = [];
            const hasBadge = badgeHolder[playerKey].includes(badgeId);
            if (condition && !hasBadge) {
                badgeHolder[playerKey].push(badgeId);
            } else if (!condition && hasBadge) {
                badgeHolder[playerKey] = badgeHolder[playerKey].filter(b => b !== badgeId);
            }
        };
    
        // --- 1. HAKEM BADGES ---
        const hakemStats = {};
        Object.keys(game.players).forEach(pKey => {
            hakemStats[pKey] = {
                hakemHands: [], successfulHands: [], failedHands: [],
                totalShelemScore: 0, totalNegativeScore: 0, totalYasaScore: 0,
                commitments: [], suitCounts: { hearts: 0, spades: 0, clubs: 0, diamonds: 0 },
                totalHakemScore: 0, totalOpponentScoreWhenHakem: 0,
            };
        });
    
        allHands.forEach(hand => {
            const hakemKey = hand.hakem;
            const stats = hakemStats[hakemKey];
            const hakemTeam = getTeam(game, hakemKey);
            const opponentTeam = getOppositeTeam(game, hakemKey);
            const hakemScore = hand.scores[hakemTeam];
    
            stats.hakemHands.push(hand);
            stats.commitments.push(hand.commitment);
            if (hand.suit) stats.suitCounts[hand.suit]++;
            stats.totalHakemScore += hakemScore;
            stats.totalOpponentScoreWhenHakem += hand.scores[opponentTeam];
    
            if (hand.hakemScore === 165) {
                stats.totalShelemScore += hakemScore;
            }
            if (hakemScore < 0) {
                stats.failedHands.push(hand);
                stats.totalNegativeScore += hakemScore;
                if (hand.hakemScore < 85 && hand.commitment < 165) { // Yasa
                    stats.totalYasaScore += hakemScore;
                }
            } else {
                stats.successfulHands.push(hand);
            }
        });
    
        // Remove temporary hakem badges before recalculation
        Object.keys(newBadges.hakems).forEach(pKey => {
            newBadges.hakems[pKey] = newBadges.hakems[pKey].filter(b => badgeData[b] && badgeData[b].permanent);
        });
    
        // Calculate winners for competitive temporary badges
        const findWinners = (statsObject, metric, compareFn = (a, b) => a > b) => {
            let bestValue = null;
            let winners = [];
            Object.keys(statsObject).forEach(pKey => {
                const value = metric(statsObject[pKey]);
                if (value === null || value === undefined || Number.isNaN(value)) return;
    
                if (bestValue === null || compareFn(value, bestValue)) {
                    bestValue = value;
                    winners = [pKey];
                } else if (value === bestValue) {
                    winners.push(pKey);
                }
            });
            return { winners, bestValue };
        };
        
        // Assign Hakem Badges
        Object.keys(game.players).forEach(pKey => {
            const stats = hakemStats[pKey];
            // Permanent
            if (stats.totalShelemScore > 0) updatePlayerBadges(newBadges.hakems, pKey, 'shelem_kar', true);
            if (stats.failedHands.length > 0) updatePlayerBadges(newBadges.hakems, pKey, 'manfi_khor', true);
            if (stats.totalYasaScore < 0) updatePlayerBadges(newBadges.hakems, pKey, 'yasa_khor', true);
    
            // Individual Temporary
            if (stats.hakemHands.length > 3) {
                updatePlayerBadges(newBadges.hakems, pKey, 'del_chi', stats.suitCounts.hearts / stats.hakemHands.length > 0.5);
                updatePlayerBadges(newBadges.hakems, pKey, 'gishniz_chi', stats.suitCounts.clubs / stats.hakemHands.length >= 0.5);
                updatePlayerBadges(newBadges.hakems, pKey, 'pik_chi', stats.suitCounts.spades / stats.hakemHands.length >= 0.5);
                updatePlayerBadges(newBadges.hakems, pKey, 'khesht_chi', stats.suitCounts.diamonds / stats.hakemHands.length >= 0.5);
            }
             if (stats.hakemHands.length >= 2) {
                updatePlayerBadges(newBadges.hakems, pKey, 'doshman_shad_kon', stats.totalHakemScore < stats.totalOpponentScoreWhenHakem);
            }
        });
        
        // Competitive Temporary
        const shelemKarCount = Object.keys(game.players).filter(p => newBadges.hakems[p].includes('shelem_kar')).length;
        if (shelemKarCount > 1) {
            findWinners(hakemStats, s => s.totalShelemScore > 0 ? s.totalShelemScore : null).winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'shelem_kar_azam', true));
        }

        const manfiKhorCount = Object.keys(game.players).filter(p => newBadges.hakems[p].includes('manfi_khor')).length;
        if (manfiKhorCount > 1) {
            findWinners(hakemStats, s => s.totalNegativeScore < 0 ? s.totalNegativeScore : null, (a, b) => a < b).winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'manfi_khor_azam', true));
        }

        const yasaKhorCount = Object.keys(game.players).filter(p => newBadges.hakems[p].includes('yasa_khor')).length;
        if (yasaKhorCount > 1) {
            findWinners(hakemStats, s => s.totalYasaScore < 0 ? s.totalYasaScore : null, (a, b) => a < b).winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'yasa_khor_azam', true));
        }

        const aghaBalatar = findWinners(hakemStats, s => {
            const successfulCommits = s.successfulHands.map(h => h.commitment);
            return successfulCommits.length > 0 ? Math.max(...successfulCommits) : null;
        });
        if (aghaBalatar.winners.length === 1 && aghaBalatar.bestValue > 130) {
            updatePlayerBadges(newBadges.hakems, aghaBalatar.winners[0], 'agha_balatar', true);
        }

        const gondeGooz = findWinners(hakemStats, s => {
            const failedCommits = s.failedHands.map(h => h.commitment);
            return failedCommits.length > 0 ? Math.max(...failedCommits) : null;
        });
        if (gondeGooz.winners.length === 1 && gondeGooz.bestValue > 135) {
            updatePlayerBadges(newBadges.hakems, gondeGooz.winners[0], 'gonde_gooz_azam', true);
        }
        
        const khoshshans = findWinners(hakemStats, s => s.successfulHands.length > 0 ? s.successfulHands.reduce((acc, h) => acc + h.hakemScore - h.commitment, 0) / s.successfulHands.length : null, (a, b) => a < b);
        if (khoshshans.bestValue !== null && khoshshans.bestValue < 10) {
            khoshshans.winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'khoshshans_milimetri', true));
        }
        
        const mazadchi = findWinners(hakemStats, s => s.successfulHands.length > 0 ? s.successfulHands.reduce((acc, h) => acc + h.hakemScore - h.commitment, 0) / s.successfulHands.length : null);
        if (mazadchi.bestValue !== null && mazadchi.bestValue > 30) {
            mazadchi.winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'mazad_chi', true));
        }

        const badshans = findWinners(hakemStats, s => s.failedHands.length > 0 ? s.failedHands.reduce((acc, h) => acc + Math.abs(h.hakemScore - h.commitment), 0) / s.failedHands.length : null, (a, b) => a < b);
        if (badshans.bestValue !== null && badshans.bestValue < 10) {
            badshans.winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'badshans_milimetri', true));
        }
        
        findWinners(hakemStats, s => s.hakemHands.length >= 3 ? s.totalHakemScore : null).winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'super_hakem', true));
        findWinners(hakemStats, s => s.hakemHands.length >= 3 && s.totalHakemScore < 0 ? s.totalHakemScore : null, (a,b) => a < b).winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, 'super_manfi_khor', true));
    
        // Sultan badges
        ['hearts', 'spades', 'clubs', 'diamonds'].forEach(suit => {
            const { winners, bestValue } = findWinners(hakemStats, s => s.suitCounts[suit]);
            if (bestValue >= 3) {
                if (winners.length === 1) {
                    updatePlayerBadges(newBadges.hakems, winners[0], `soltan_${suit}`, true);
                } else if (winners.length > 1) {
                    winners.forEach(p => updatePlayerBadges(newBadges.hakems, p, `nim_soltan_${suit}`, true));
                }
            }
        });
    
    
        // --- 2. DEALER BADGES ---
        const dealerStats = {};
        Object.keys(game.players).forEach(pKey => { dealerStats[pKey] = { scoreDiff: 0, dealCount: 0 }; });
        const dealerOrder = [game.firstDealer, getNextPlayer(game.firstDealer), getNextPlayer(getNextPlayer(game.firstDealer)), getNextPlayer(getNextPlayer(getNextPlayer(game.firstDealer)))];
    
        allHands.forEach((hand, index) => {
            const dealerKey = dealerOrder[index % 4];
            const dealerTeam = getTeam(game, dealerKey);
            const opponentTeam = getOppositeTeam(game, dealerKey);
            dealerStats[dealerKey].scoreDiff += (hand.scores[dealerTeam] - hand.scores[opponentTeam]);
            dealerStats[dealerKey].dealCount++;
        });
    
        Object.keys(newBadges.dealers).forEach(pKey => { newBadges.dealers[pKey] = []; });
        
        const dastTala = findWinners(dealerStats, s => s.dealCount >= 3 && s.scoreDiff > 0 ? s.scoreDiff : null);
        if (dastTala.winners.length === 1) {
            updatePlayerBadges(newBadges.dealers, dastTala.winners[0], 'dast_tala', true);
        }

        const dastSiah = findWinners(dealerStats, s => s.dealCount >= 3 && s.scoreDiff < 0 ? s.scoreDiff : null, (a,b) => a < b);
        if (dastSiah.winners.length === 1) {
            updatePlayerBadges(newBadges.dealers, dastSiah.winners[0], 'dast_siah', true);
        }
    
    
        // --- 3. TEAM BADGES ---
        let team1Score = 0, team2Score = 0;
        allHands.forEach(h => { team1Score += h.scores.team1; team2Score += h.scores.team2; });
        
        const wasBehindT1 = oldBadges.teams.team1?.includes('be_khodet_bia') || oldBadges.teams.team1?.includes('shoma_mitoonid');
        const wasBehindT2 = oldBadges.teams.team2?.includes('be_khodet_bia') || oldBadges.teams.team2?.includes('shoma_mitoonid');
    
        // Remove temporary team badges before recalculation
        newBadges.teams.team1 = newBadges.teams.team1.filter(b => badgeData[b] && badgeData[b].permanent);
        newBadges.teams.team2 = newBadges.teams.team2.filter(b => badgeData[b] && badgeData[b].permanent);
    
        const diff = Math.abs(team1Score - team2Score);
        const threshold = 0.35 * game.targetScore;
    
        if (team1Score < team2Score && diff > threshold) {
            updatePlayerBadges(newBadges.teams, 'team1', 'be_khodet_bia', true);
        } else if (team1Score < team2Score && wasBehindT1) {
            updatePlayerBadges(newBadges.teams, 'team1', 'shoma_mitoonid', true);
        } else if (team1Score > team2Score && wasBehindT1) {
            updatePlayerBadges(newBadges.teams, 'team1', 'bazgasht_ghahremanane', true);
        }
    
        if (team2Score < team1Score && diff > threshold) {
            updatePlayerBadges(newBadges.teams, 'team2', 'be_khodet_bia', true);
        } else if (team2Score < team1Score && wasBehindT2) {
            updatePlayerBadges(newBadges.teams, 'team2', 'shoma_mitoonid', true);
        } else if (team2Score > team1Score && wasBehindT2) {
            updatePlayerBadges(newBadges.teams, 'team2', 'bazgasht_ghahremanane', true);
        }
        
        // --- 4. COMPARE AND GENERATE CHANGES ---
        const badgeLog = {};

        const diffBadges = (oldB, newB, holderKey, holderType) => {
            const added = newB.filter(b => !oldB.includes(b));
            const removed = oldB.filter(b => !newB.includes(b));
            added.forEach(b => {
                 if(!badgeLog[b]) badgeLog[b] = { added: [], removed: [] };
                 badgeLog[b].added.push({key: holderKey, type: holderType});
            });
            removed.forEach(b => {
                if(!badgeLog[b]) badgeLog[b] = { added: [], removed: [] };
                badgeLog[b].removed.push({key: holderKey, type: holderType});
            });
        };

        ['p1', 'p2', 'p3', 'p4'].forEach(pKey => {
            diffBadges(oldBadges.hakems[pKey] || [], newBadges.hakems[pKey] || [], pKey, 'player');
            diffBadges(oldBadges.dealers[pKey] || [], newBadges.dealers[pKey] || [], pKey, 'player');
        });
        
        diffBadges(oldBadges.teams.team1 || [], newBadges.teams.team1 || [], 'team1', 'team');
        diffBadges(oldBadges.teams.team2 || [], newBadges.teams.team2 || [], 'team2', 'team');

        const changes = Object.keys(badgeLog).map(badgeId => {
            const change = badgeLog[badgeId];
            const badgeChip = `<span class="badge-chip" data-badge-id="${badgeId}">${badgeData[badgeId].name}</span>`;
            
            const getName = (item) => {
                if (item.type === 'player') return game.players[item.key];
                if (item.type === 'team') {
                    const players = getTeamPlayers(game, item.key).map(p => game.players[p]);
                    return `تیم ${players.join(' و ')}`;
                }
            };

            const addedNames = change.added.map(getName).join(' و ');
            const removedNames = change.removed.map(getName).join(' و ');

            let message = `نشان ${badgeChip} `;
            if (removedNames) message += `از ${removedNames} پس گرفته شد`;
            if (addedNames && removedNames) message += ` و به ${addedNames} اعطا شد.`;
            else if (addedNames) message += `به ${addedNames} اعطا شد.`;
            else message += '.';
            
            return message;
        });
        
        return { newBadges, changes };
    };

    // --- IMPORT/EXPORT ---
    const exportSingleGame = (gameId) => {
        const game = findGame(gameId);
        if (!game) return;
        const dataStr = JSON.stringify(game, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileName = `shelem_game_${game.name.replace(/ /g, '_')}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileName);
        linkElement.click();
    };

    // --- EVENT LISTENERS ---
    document.getElementById('new-game-btn').addEventListener('click', () => showNewGameModal());
    document.getElementById('rules-btn').addEventListener('click', () => navigateTo('rules-page'));
    
    document.getElementById('export-btn').addEventListener('click', () => {
        const dataStr = JSON.stringify(state.games, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileDefaultName = `shelem_backup_${moment().format('jYYYY-jMM-jDD')}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    });

    document.getElementById('import-file').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (Array.isArray(importedData)) { // Full backup
                    const modalHtml = `
                        <div class="modal-header"><h2>ورود اطلاعات کلی</h2></div>
                        <p>یک فایل پشتیبان کلی انتخاب شده. چه کاری انجام شود؟</p>
                        <div class="button-grid import-options" style="grid-template-columns: 1fr; gap: 0.5rem;">
                            <button class="grid-btn" data-action="merge-new"><strong>ادغام:</strong> فقط بازی‌هایی که از قبل وجود ندارند را وارد کن.</button>
                            <button class="grid-btn" data-action="smart-merge"><strong>ادغام هوشمند:</strong> اگر بازی با شناسه تکراری وجود دارد، نسخه‌ی جدیدتر را نگه‌دار.</button>
                            <button class="grid-btn" data-action="import-as-new"><strong>وارد کردن همه به‌عنوان جدید:</strong> همه بازی‌های فایل را با شناسه جدید وارد کن.</button>
                            <button class="grid-btn" data-action="replace"><strong>جایگزینی همه:</strong> همه اطلاعات موجود را حذف کن و اطلاعات فایل را جایگزین آن کن.</button>
                            <button class="grid-btn" data-action="cancel"><strong>انصراف</strong></button>
                        </div>
                    `;
                    openModal(modalHtml, () => {
                        document.querySelectorAll('.import-options .grid-btn').forEach(btn => btn.addEventListener('click', (e) => {
                            const action = e.currentTarget.dataset.action;
                            const existingIds = new Set(state.games.map(g => g.id));
                            
                            if (action === 'merge-new') {
                                const newGames = importedData.filter(g => g && g.id && !existingIds.has(g.id));
                                state.games.push(...newGames);
                            } else if (action === 'replace') {
                                state.games = importedData;
                            } else if (action === 'import-as-new') {
                                const newGames = importedData.map(g => ({ ...g, id: generateUUID() }));
                                state.games.push(...newGames);
                            } else if (action === 'smart-merge') {
                                importedData.forEach(importedGame => {
                                    const existingGame = state.games.find(g => g.id === importedGame.id);
                                    if (existingGame) {
                                        if (importedGame.lastActivity > existingGame.lastActivity) {
                                            state.games = state.games.map(g => g.id === importedGame.id ? importedGame : g);
                                        }
                                    } else {
                                        state.games.push(importedGame);
                                    }
                                });
                            }
                            
                            if (action !== 'cancel') {
                                db.save();
                                renderHomePage();
                            }
                            closeModal();
                        }));
                    });
                } else if (importedData && importedData.id) { // Single game
                    const existingGame = state.games.find(g => g.id === importedData.id);
                    if (!existingGame) {
                        state.games.push(importedData);
                        db.save();
                        renderHomePage();
                    } else {
                        const isNewer = importedData.lastActivity > existingGame.lastActivity;
                        const modalHtml = `
                            <div class="modal-header"><h2>بازی تکراری یافت شد</h2></div>
                            <p>بازی <strong>"${importedData.name}"</strong> از قبل در برنامه شما وجود دارد.</p>
                            <p>اطلاعات فایل ${isNewer ? '<strong>جدیدتر</strong>' : 'قدیمی‌تر'} از اطلاعات موجود است.</p>
                            <div style="font-size: 0.9rem; color: #555; margin: 1rem 0;">
                                <div>نسخه فایل: ${toPersianDigits(importedData.hands.length)} دست، آخرین فعالیت: ${getPersianDateTime(importedData.lastActivity)}</div>
                                <div>نسخه موجود: ${toPersianDigits(existingGame.hands.length)} دست، آخرین فعالیت: ${getPersianDateTime(existingGame.lastActivity)}</div>
                            </div>
                            <div class="button-grid import-options" style="grid-template-columns: 1fr; gap: 0.5rem;">
                                <button class="grid-btn" data-action="replace"><strong>جایگزینی:</strong> اطلاعات فایل را جایگزین اطلاعات موجود کن.</button>
                                <button class="grid-btn" data-action="save-as-new"><strong>ذخیره به‌عنوان جدید:</strong> بازی موجود را نگه‌دار و این را به عنوان یک بازی جدید ذخیره کن.</button>
                                <button class="grid-btn" data-action="cancel"><strong>انصراف</strong></button>
                            </div>
                        `;
                        openModal(modalHtml, () => {
                            document.querySelectorAll('.import-options .grid-btn').forEach(btn => btn.addEventListener('click', (e) => {
                                const action = e.currentTarget.dataset.action;
                                if (action === 'replace') {
                                    state.games = state.games.map(g => g.id === importedData.id ? importedData : g);
                                } else if (action === 'save-as-new') {
                                    state.games.push({ ...importedData, id: generateUUID() });
                                }
                                
                                if (action !== 'cancel') {
                                    db.save();
                                    renderHomePage();
                                }
                                closeModal();
                            }));
                        });
                    }
                } else {
                    alert('فایل نامعتبر است.');
                }
            } catch (error) {
                alert('خطا در خواندن فایل.');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    });
    
    document.body.addEventListener('click', (e) => {
        if (e.target.closest('.delete-game-btn')) {
            const gameId = e.target.closest('.delete-game-btn').dataset.gameId;
            const game = findGame(gameId);
            const confirmationModalHtml = `
                <div class="modal-header"><h2>تایید حذف</h2></div>
                <p>آیا از حذف بازی «${game.name}» مطمئن هستید؟</p>
                <div class="summary-buttons">
                    <button id="confirm-delete-btn" class="btn btn-danger">بله، حذف کن</button>
                    <button id="cancel-delete-btn" class="btn btn-secondary">انصراف</button>
                </div>
            `;
            openModal(confirmationModalHtml, () => {
                document.getElementById('confirm-delete-btn').addEventListener('click', () => {
                    state.games = state.games.filter(g => g.id !== gameId);
                    db.save();
                    renderHomePage();
                    closeModal();
                });
                document.getElementById('cancel-delete-btn').addEventListener('click', closeModal);
            });
        }
        
        if (e.target.closest('.badge-chip')) {
            const badgeId = e.target.closest('.badge-chip').dataset.badgeId;
            const badge = badgeData[badgeId];
            if (badge) {
                // If a modal is already open, push its current state to the stack
                if (!modalContainer.classList.contains('hidden')) {
                    state.modalStack.push(modalContent.innerHTML);
                }
                const modalHtml = `
                    <div class="modal-header">
                        <h2>${badge.name}</h2>
                        <button class="modal-close-btn">&times;</button>
                    </div>
                    <p>${badge.description}</p>
                `;
                openModal(modalHtml);
            }
        }
    });

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            appHeader.classList.add('scrolled');
            mainContent.classList.add('header-scrolled');
        } else {
            appHeader.classList.remove('scrolled');
            mainContent.classList.remove('header-scrolled');
        }
    });

    // --- INITIALIZATION ---
    const init = () => {
        db.load();
        if (reopenStaleFinished(state.games)) db.save();
        renderRulesBadges();
        state.history = [{ page: 'home-page', context: null }];
        updateUI('home-page', null);
    };

    init();
});
