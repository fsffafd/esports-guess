const API_BASE = '';

let currentUser = null;
let selectedDate = '';
let tournamentFilter = '';
let matchesCache = [];
let currentRankType = 'overall';

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); }

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_BASE + url, {
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) {
    clearToken();
    showScreen('auth-screen');
    throw new Error('请重新登录');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// AUTH
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(btn.dataset.tab + '-form').classList.add('active');
    document.getElementById('auth-error').textContent = '';
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: {
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value
      }
    });
    setToken(data.token);
    showToast(data.message);
    await loadUser();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  const pw = document.getElementById('reg-password').value;
  const pw2 = document.getElementById('reg-password2').value;
  if (pw !== pw2) { errEl.textContent = '两次密码不一致'; return; }
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: {
        username: document.getElementById('reg-username').value,
        password: pw
      }
    });
    setToken(data.token);
    showToast('注册成功');
    await loadUser();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  currentUser = null;
  showScreen('auth-screen');
});

async function loadUser() {
  try {
    currentUser = await api('/api/me');
    document.getElementById('user-points').textContent = currentUser.points.toLocaleString();
    showScreen('main-screen');
    switchPage('home');
  } catch {
    showScreen('auth-screen');
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// NAVIGATION
document.querySelectorAll('.bottom-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    switchPage(page);
  });
});

function switchPage(page) {
  document.querySelectorAll('.bottom-nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.bottom-nav-item[data-page="${page}"]`).classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');

  if (page === 'home') loadHomePage();
  else if (page === 'match') { loadDateTabs(); loadTournamentFilter(); }
  else if (page === 'tournament') loadTournaments();
  else if (page === 'rank') loadRankings(currentRankType);
  else if (page === 'profile') loadProfile();
}

// HOME PAGE
async function loadHomePage() {
  const today = new Date();
  const beijing = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const dateStr = `${beijing.getFullYear()}-${String(beijing.getMonth()+1).padStart(2,'0')}-${String(beijing.getDate()).padStart(2,'0')}`;
  document.getElementById('home-date').textContent = dateStr;

  try {
    const [matches, stats] = await Promise.all([
      api('/api/matches?date=' + dateStr),
      api('/api/user/stats').catch(() => null)
    ]);

    renderHomeMatches(matches);
    renderHomeStats(stats);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderHomeMatches(matches) {
  const container = document.getElementById('home-matches');
  if (matches.length === 0) {
    container.innerHTML = '<div class="empty-state">今日暂无赛事</div>';
    return;
  }

  const groups = {};
  for (const m of matches) {
    const key = m.tournament_name || '友谊赛';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }

  container.innerHTML = Object.entries(groups).map(([name, ms]) => `
    <div class="tournament-group">
      <div class="tournament-group-header">
        <span class="tournament-group-name">${esc(name)}</span>
        <span class="tournament-group-count">${ms.length}场</span>
      </div>
      ${ms.map(m => renderMatchCard(m)).join('')}
    </div>
  `).join('');
}

function renderHomeStats(stats) {
  const container = document.getElementById('home-quick-stats');
  if (!stats) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="home-stat-card">
      <div class="home-stat-value">${stats.totalBets}</div>
      <div class="home-stat-label">总投注数</div>
    </div>
    <div class="home-stat-card">
      <div class="home-stat-value ${stats.winRate >= 50 ? 'profit-pos' : 'profit-neg'}">${stats.winRate}%</div>
      <div class="home-stat-label">胜率</div>
    </div>
    <div class="home-stat-card">
      <div class="home-stat-value ${stats.totalProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toLocaleString()}</div>
      <div class="home-stat-label">总盈亏</div>
    </div>
    <div class="home-stat-card">
      <div class="home-stat-value">${stats.totalPending}</div>
      <div class="home-stat-label">待结算</div>
    </div>
  `;
}

// DATE TABS
async function loadDateTabs() {
  try {
    const dates = await api('/api/matches/dates');
    renderDateTabs(dates);
    if (!selectedDate) {
      const today = dates.find(d => d.isToday);
      selectedDate = today ? today.date : dates[0].date;
    }
    highlightDateTab();
    loadMatchesForDate();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderDateTabs(dates) {
  const container = document.getElementById('date-tabs');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  container.innerHTML = dates.map(d => {
    const dateObj = new Date(d.date + 'T00:00:00+08:00');
    const weekday = '周' + weekdays[dateObj.getDay()];
    const dayStr = d.date.slice(5).replace('-', '/');
    const classes = ['date-tab'];
    if (d.isToday) classes.push('today');
    if (d.date === selectedDate) classes.push('active');

    return `
      <button class="${classes.join(' ')}" data-date="${d.date}">
        <span class="date-weekday">${d.isToday ? '今天' : weekday}</span>
        <span class="date-day">${dayStr}</span>
        ${d.hasMatches ? '<span class="date-dot"></span>' : ''}
      </button>
    `;
  }).join('');

  container.querySelectorAll('.date-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDate = btn.dataset.date;
      highlightDateTab();
      loadMatchesForDate();
    });
  });
}

function highlightDateTab() {
  document.querySelectorAll('.date-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.date === selectedDate);
  });
}

// TOURNAMENT FILTER
async function loadTournamentFilter() {
  try {
    const list = await api('/api/matches/tournaments-list');
    const select = document.getElementById('tournament-filter');
    const current = select.value;
    select.innerHTML = '<option value="">全部赛事</option>' +
      list.map(t => `<option value="${esc(t.tournament_name)}">${esc(t.tournament_name)} (${t.match_count})</option>`).join('');
    if (current) select.value = current;

    select.onchange = () => {
      tournamentFilter = select.value;
      loadMatchesForDate();
    };
  } catch {}
}

// MATCHES
async function loadMatchesForDate() {
  try {
    let url = '/api/matches?date=' + selectedDate;
    if (tournamentFilter) url += '&tournament=' + encodeURIComponent(tournamentFilter);
    matchesCache = await api(url);
    renderMatchesGrouped();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderMatchesGrouped() {
  const container = document.getElementById('matches-grouped');

  if (matchesCache.length === 0) {
    container.innerHTML = '<div class="empty-state">当日暂无比赛</div>';
    return;
  }

  const groups = {};
  for (const m of matchesCache) {
    const key = m.tournament_name || '友谊赛';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }

  container.innerHTML = Object.entries(groups).map(([name, matches]) => `
    <div class="tournament-group">
      <div class="tournament-group-header">
        <span class="tournament-group-name">${esc(name)}</span>
        <span class="tournament-group-count">${matches.length}场</span>
      </div>
      ${matches.map(m => renderMatchCard(m)).join('')}
    </div>
  `).join('');
}

function renderMatchCard(m) {
  const timeStr = formatMatchTime(m.match_time);
  const boFormat = m.bo_format || 'BO3';

  let statusHtml = '';
  if (m.status === 'betting') {
    statusHtml = '<span class="live-badge"><span class="live-dot"></span>LIVE</span>';
  } else if (m.status === 'finished') {
    statusHtml = '<span class="match-status-badge status-finished">已结束</span>';
  } else {
    statusHtml = '<span class="match-status-badge status-upcoming">待开始</span>';
  }

  const score1Display = (m.status === 'finished' || m.status === 'betting') ? (m.score1 || 0) : '';
  const score2Display = (m.status === 'finished' || m.status === 'betting') ? (m.score2 || 0) : '';
  const winnerClass1 = m.winner === 1 ? ' winner' : '';
  const winnerClass2 = m.winner === 2 ? ' winner' : '';

  let gameScoresHtml = '';
  if (m.game_scores) {
    gameScoresHtml = `<div class="game-scores">${esc(m.game_scores)}</div>`;
  }

  let actionHtml = '';
  if (m.status === 'upcoming') {
    actionHtml = `<button class="btn btn-primary btn-sm" onclick="openBetModal(${m.id})">投注</button>`;
  }

  return `
    <div class="match-card">
      <div class="match-time-col">
        <div class="match-time-text">${timeStr}</div>
        <span class="match-bo">${esc(boFormat)}</span>
      </div>
      <div class="match-teams-col">
        <div class="match-team-row">
          <span class="match-team-name${winnerClass1}">${esc(m.team1)}</span>
          <span class="match-score${winnerClass1}">${score1Display}</span>
        </div>
        <div class="match-team-row">
          <span class="match-team-name${winnerClass2}">${esc(m.team2)}</span>
          <span class="match-score${winnerClass2}">${score2Display}</span>
        </div>
        ${gameScoresHtml}
      </div>
      <div class="match-right-col">
        ${statusHtml}
        ${actionHtml}
      </div>
    </div>
  `;
}

// BET MODAL
window.openBetModal = function(matchId) {
  const match = matchesCache.find(m => m.id === matchId);
  if (!match) return;

  showModal(`投注 - ${match.team1} vs ${match.team2}`, `
    <p style="margin-bottom:14px;color:var(--t2);font-size:13px;">选择获胜队伍并输入投注积分</p>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <button class="btn bet-team-btn" data-team="1" style="flex:1;padding:12px;font-size:14px;">${esc(match.team1)}</button>
      <button class="btn bet-team-btn" data-team="2" style="flex:1;padding:12px;font-size:14px;">${esc(match.team2)}</button>
    </div>
    <div class="field">
      <label style="font-size:11px;color:var(--t2);margin-bottom:6px;display:block;">投注积分</label>
      <input type="number" id="bet-amount" min="1" max="${currentUser.points}" placeholder="最多 ${currentUser.points.toLocaleString()}">
    </div>
    <div style="display:flex;gap:6px;margin-bottom:14px;">
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=100">100</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=500">500</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=1000">1K</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=5000">5K</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=${currentUser.points}">全部</button>
    </div>
    <button class="btn btn-primary btn-block" onclick="submitBet(${matchId})">确认投注</button>
  `);

  document.querySelectorAll('.bet-team-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bet-team-btn').forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
    });
  });
};

window.submitBet = async function(matchId) {
  const teamBtn = document.querySelector('.bet-team-btn.btn-primary');
  if (!teamBtn) { showToast('请选择队伍', true); return; }
  const amount = parseInt(document.getElementById('bet-amount').value);
  if (!amount || amount <= 0) { showToast('请输入有效金额', true); return; }

  try {
    const data = await api('/api/bet', {
      method: 'POST',
      body: { matchId, betTeam: parseInt(teamBtn.dataset.team), amount }
    });
    showToast(data.message);
    currentUser.points = data.remainingPoints;
    document.getElementById('user-points').textContent = currentUser.points.toLocaleString();
    closeModal();
    loadMatchesForDate();
  } catch (err) {
    showToast(err.message, true);
  }
};

// TOURNAMENTS
let selectedTeamId = null;
let selectedPredType = null;

async function loadTournaments() {
  try {
    const tournaments = await api('/api/tournaments');
    renderTournaments(tournaments);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderTournaments(tournaments) {
  const list = document.getElementById('tournaments-list');
  if (tournaments.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无锦标赛</div>';
    return;
  }

  const statusMap = { upcoming: '预测中', closed: '已截止', finished: '已结束' };
  const predTypeLabels = {
    champion: '冠军', runner_up: '亚军', third_place: '季军',
    top4: '四强', top8: '八强', qualify: '出线'
  };
  const multipliers = { champion: 20, runner_up: 10, third_place: 7, top4: 4, top8: 3, qualify: 2 };

  list.innerHTML = tournaments.map(t => `
    <div class="tournament-card">
      <div class="tournament-name">${esc(t.name)}</div>
      <div class="tournament-status">${statusMap[t.status] || t.status}</div>
      <div class="teams-grid">
        ${t.teams.map(team => `
          <div class="team-chip" data-team-id="${team.id}" data-tournament-id="${t.id}">${esc(team.team_name)}</div>
        `).join('')}
      </div>
      ${t.status === 'upcoming' ? `
        <div class="pred-types">
          ${Object.entries(predTypeLabels).map(([key, label]) => `
            <button class="pred-type-btn" data-type="${key}" data-tournament-id="${t.id}">${label} x${multipliers[key]}</button>
          `).join('')}
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:12px;" onclick="openPredictModal(${t.id})">提交预测</button>
      ` : ''}
    </div>
  `).join('');

  document.querySelectorAll('.team-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tid = chip.dataset.tournamentId;
      document.querySelectorAll(`.team-chip[data-tournament-id="${tid}"]`).forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedTeamId = parseInt(chip.dataset.teamId);
    });
  });

  document.querySelectorAll('.pred-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.tournamentId;
      document.querySelectorAll(`.pred-type-btn[data-tournament-id="${tid}"]`).forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPredType = btn.dataset.type;
    });
  });
}

window.openPredictModal = function(tournamentId) {
  if (!selectedTeamId) { showToast('请选择一支队伍', true); return; }
  if (!selectedPredType) { showToast('请选择预测类型', true); return; }

  const predLabels = {
    champion: '冠军', runner_up: '亚军', third_place: '季军',
    top4: '四强', top8: '八强', qualify: '出线'
  };
  const multipliers = { champion: 20, runner_up: 10, third_place: 7, top4: 4, top8: 3, qualify: 2 };

  showModal('提交预测', `
    <p style="margin-bottom:12px;color:var(--t2);font-size:13px;">
      预测类型: <strong style="color:var(--accent);">${predLabels[selectedPredType]}</strong> (倍率 x${multipliers[selectedPredType]})
    </p>
    <div class="field">
      <label style="font-size:11px;color:var(--t2);margin-bottom:6px;display:block;">投注积分</label>
      <input type="number" id="pred-amount" min="1" max="${currentUser.points}" placeholder="最多 ${currentUser.points.toLocaleString()}">
    </div>
    <p style="font-size:12px;color:var(--t3);margin-bottom:14px;">
      猜对可获得 投注额 × ${multipliers[selectedPredType]} 积分
    </p>
    <button class="btn btn-primary btn-block" onclick="submitPredict(${tournamentId})">确认预测</button>
  `);
};

window.submitPredict = async function(tournamentId) {
  const amount = parseInt(document.getElementById('pred-amount').value);
  if (!amount || amount <= 0) { showToast('请输入有效金额', true); return; }

  try {
    const data = await api('/api/predict', {
      method: 'POST',
      body: { tournamentId, predictionType: selectedPredType, teamId: selectedTeamId, betAmount: amount }
    });
    showToast(data.message);
    currentUser.points = data.remainingPoints;
    document.getElementById('user-points').textContent = currentUser.points.toLocaleString();
    closeModal();
    selectedTeamId = null;
    selectedPredType = null;
    loadTournaments();
  } catch (err) {
    showToast(err.message, true);
  }
};

// RANKINGS
document.querySelectorAll('.rank-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rank-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentRankType = tab.dataset.type;
    loadRankings(currentRankType);
  });
});

async function loadRankings(type) {
  try {
    if (type === 'overall') {
      const data = await api('/api/leaderboard/overall');
      renderOverallRank(data);
    } else {
      const data = await api('/api/leaderboard/daily');
      renderDailyRank(data);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderOverallRank(rankings) {
  const summary = document.getElementById('rank-summary');
  const list = document.getElementById('rank-list');

  if (rankings.length === 0) {
    summary.innerHTML = '';
    list.innerHTML = '<div class="empty-state">暂无排行数据</div>';
    return;
  }

  const totalPoints = rankings.reduce((s, r) => s + r.points, 0);
  summary.innerHTML = `
    <div class="rank-summary-item">参与人数: <strong>${rankings.length}</strong></div>
    <div class="rank-summary-item">总积分池: <strong>${totalPoints.toLocaleString()}</strong></div>
  `;

  list.innerHTML = rankings.map((u, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? ' r' + rank : '';
    const medal = rank === 1 ? '&#129351;' : rank === 2 ? '&#129352;' : rank === 3 ? '&#129353;' : '';
    const profitClass = u.totalProfit > 0 ? 'profit-pos' : u.totalProfit < 0 ? 'profit-neg' : 'profit-zero';
    const profitStr = (u.totalProfit >= 0 ? '+' : '') + u.totalProfit.toLocaleString();

    return `
      <div class="rank-row">
        <div class="rank-num${rankClass}">${medal || rank}</div>
        <div class="rank-name">${esc(u.username)}</div>
        <div class="rank-value">${u.points.toLocaleString()}</div>
        <div class="rank-profit ${profitClass}">${profitStr}</div>
      </div>
    `;
  }).join('');
}

function renderDailyRank(data) {
  const summary = document.getElementById('rank-summary');
  const list = document.getElementById('rank-list');

  const rankings = data.rankings || [];

  if (rankings.length === 0) {
    summary.innerHTML = '';
    list.innerHTML = '<div class="empty-state">今日暂无结算记录</div>';
    return;
  }

  const totalProfit = rankings.reduce((s, r) => s + r.dailyProfit, 0);
  const winners = rankings.filter(r => r.dailyProfit > 0).length;
  const losers = rankings.filter(r => r.dailyProfit < 0).length;

  summary.innerHTML = `
    <div class="rank-summary-item">日期: <strong>${data.date}</strong></div>
    <div class="rank-summary-item">参与: <strong>${rankings.length}</strong></div>
    <div class="rank-summary-item">盈利: <strong style="color:var(--green)">${winners}人</strong></div>
    <div class="rank-summary-item">亏损: <strong style="color:var(--red)">${losers}人</strong></div>
    <div class="rank-summary-item">总盈亏: <strong class="${totalProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}</strong></div>
  `;

  list.innerHTML = rankings.map((u, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? ' r' + rank : '';
    const medal = rank === 1 ? '&#129351;' : rank === 2 ? '&#129352;' : rank === 3 ? '&#129353;' : '';
    const profitClass = u.dailyProfit > 0 ? 'profit-pos' : u.dailyProfit < 0 ? 'profit-neg' : 'profit-zero';
    const profitStr = (u.dailyProfit >= 0 ? '+' : '') + u.dailyProfit.toLocaleString();

    return `
      <div class="rank-row">
        <div class="rank-num${rankClass}">${medal || rank}</div>
        <div class="rank-name">${esc(u.username)}</div>
        <div class="rank-profit ${profitClass}">${profitStr}</div>
      </div>
    `;
  }).join('');
}

// PROFILE
async function loadProfile() {
  try {
    const [stats, bets, predictions] = await Promise.all([
      api('/api/user/stats'),
      api('/api/my-bets'),
      api('/api/my-predictions')
    ]);

    renderProfileHeader(stats);
    renderProfileStats(stats);
    renderProfileBets(bets, predictions);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderProfileHeader(stats) {
  const container = document.getElementById('profile-header');
  const initial = stats.username.charAt(0).toUpperCase();

  container.innerHTML = `
    <div class="profile-avatar">${esc(initial)}</div>
    <div class="profile-username">${esc(stats.username)}</div>
    <div class="profile-points">${stats.points.toLocaleString()} 积分</div>
  `;
}

function renderProfileStats(stats) {
  const container = document.getElementById('profile-stats');
  const profitClass = stats.totalProfit >= 0 ? 'green' : 'red';
  const profitStr = (stats.totalProfit >= 0 ? '+' : '') + stats.totalProfit.toLocaleString();

  container.innerHTML = `
    <div class="profile-stat">
      <div class="profile-stat-val">${stats.totalBets}</div>
      <div class="profile-stat-lbl">总投注</div>
    </div>
    <div class="profile-stat">
      <div class="profile-stat-val green">${stats.totalWon}</div>
      <div class="profile-stat-lbl">已赢</div>
    </div>
    <div class="profile-stat">
      <div class="profile-stat-val red">${stats.totalLost}</div>
      <div class="profile-stat-lbl">已输</div>
    </div>
    <div class="profile-stat">
      <div class="profile-stat-val">${stats.winRate}%</div>
      <div class="profile-stat-lbl">胜率</div>
    </div>
    <div class="profile-stat">
      <div class="profile-stat-val ${profitClass}">${profitStr}</div>
      <div class="profile-stat-lbl">总盈亏</div>
    </div>
    <div class="profile-stat">
      <div class="profile-stat-val">${stats.totalPending}</div>
      <div class="profile-stat-lbl">待结算</div>
    </div>
  `;
}

function renderProfileBets(bets, predictions) {
  const betsList = document.getElementById('profile-bets-list');
  const predsList = document.getElementById('profile-preds-list');

  if (bets.length === 0) {
    betsList.innerHTML = '<div class="empty-state">暂无比赛投注</div>';
  } else {
    betsList.innerHTML = bets.map(b => {
      const betTeam = b.bet_team === 1 ? b.team1 : b.team2;
      const statusMap = { pending: '待结算', won: '已赢', lost: '已输' };
      const statusClass = 'bet-' + b.status;
      return `
        <div class="bet-card">
          <div class="bet-info">
            <div class="bet-match">${esc(b.team1)} vs ${esc(b.team2)}</div>
            <div class="bet-detail">
              投注: ${esc(betTeam)} | <span class="${statusClass}">${statusMap[b.status]}</span>
              ${b.tournament_name ? ` | ${esc(b.tournament_name)}` : ''}
            </div>
          </div>
          <div class="bet-amount-col">
            <div class="bet-amount-val">${b.amount.toLocaleString()}</div>
            ${b.status === 'won' ? `<div class="bet-payout">+${b.payout.toLocaleString()}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  if (predictions.length === 0) {
    predsList.innerHTML = '<div class="empty-state">暂无锦标赛预测</div>';
  } else {
    const predLabels = {
      champion: '冠军', runner_up: '亚军', third_place: '季军',
      top4: '四强', top8: '八强', qualify: '出线'
    };
    predsList.innerHTML = predictions.map(p => {
      const statusMap = { pending: '待结算', won: '已赢', lost: '已输' };
      const statusClass = 'bet-' + p.status;
      return `
        <div class="bet-card">
          <div class="bet-info">
            <div class="bet-match">${esc(p.tournament_name)}</div>
            <div class="bet-detail">
              ${predLabels[p.prediction_type]}: ${esc(p.team_name)} | <span class="${statusClass}">${statusMap[p.status]}</span>
            </div>
          </div>
          <div class="bet-amount-col">
            <div class="bet-amount-val">${p.bet_amount.toLocaleString()}</div>
            ${p.status === 'won' ? `<div class="bet-payout">+${p.payout.toLocaleString()}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

document.querySelectorAll('.profile-sub-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.profile-sub-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const sub = tab.dataset.sub;
    document.getElementById('profile-bets-list').classList.toggle('hidden', sub !== 'bets');
    document.getElementById('profile-preds-list').classList.toggle('hidden', sub !== 'predictions');
  });
});

// UTILS
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatMatchTime(t) {
  if (!t) return '--:--';
  try {
    const iso = t.includes('T') ? t : t.replace(' ', 'T');
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

// INIT
loadUser();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
