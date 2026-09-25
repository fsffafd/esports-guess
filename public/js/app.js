// ==================== CONFIG ====================
// CloudBase部署时，把这里改成你的云函数API地址
// 例如：const API_BASE = 'https://service-xxxxx@shanghai.apigw.tencentcs.com/release';
// 如果配置了API网关路由，保持空字符串即可
const API_BASE = '';

// ==================== STATE ====================
let currentUser = null;
let currentFilter = 'all';
let matchesCache = [];

// ==================== API ====================
function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
}

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

// ==================== TOAST ====================
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==================== MODAL ====================
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

// ==================== AUTH ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
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
    document.getElementById('user-name').textContent = currentUser.username;
    document.getElementById('user-points').textContent = currentUser.points.toLocaleString();
    showScreen('main-screen');
    loadMatches();
  } catch {
    showScreen('auth-screen');
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ==================== TABS ====================
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + tab.dataset.page).classList.add('active');

    if (tab.dataset.page === 'matches') loadMatches();
    else if (tab.dataset.page === 'tournament') loadTournaments();
    else if (tab.dataset.page === 'mybets') loadMyBets();
    else if (tab.dataset.page === 'leaderboard') loadLeaderboard();
  });
});

// ==================== MATCHES ====================
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderMatches();
  });
});

async function loadMatches() {
  try {
    matchesCache = await api('/api/matches');
    renderMatches();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderMatches() {
  const list = document.getElementById('matches-list');
  const filtered = currentFilter === 'all' ? matchesCache : matchesCache.filter(m => m.status === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">暂无比赛</div>';
    return;
  }

  list.innerHTML = filtered.map(m => {
    const statusMap = { upcoming: '待开始', betting: '进行中', finished: '已结束' };
    const statusClass = 'status-' + m.status;
    const winnerText = m.winner ? (m.winner === 1 ? m.team1 : m.team2) : '';

    return `
      <div class="card match-card">
        <div class="match-header">
          <span class="match-tournament">${esc(m.tournament_name || '友谊赛')}</span>
          <span class="match-status ${statusClass}">${statusMap[m.status]}</span>
        </div>
        <div class="match-teams">
          <div class="team-name">${esc(m.team1)}${m.winner === 1 ? ' <span class="winner-badge">胜</span>' : ''}</div>
          <div class="vs-text">VS</div>
          <div class="team-name">${esc(m.team2)}${m.winner === 2 ? ' <span class="winner-badge">胜</span>' : ''}</div>
        </div>
        ${m.match_time ? `<div class="match-time">${formatTime(m.match_time)}</div>` : ''}
        <div class="match-actions">
          ${m.status === 'upcoming' ? `
            <button class="btn btn-primary" onclick="openBetModal(${m.id})">投注</button>
          ` : ''}
          ${m.status === 'finished' && winnerText ? `
            <span style="font-size:13px;color:var(--success);">胜者: ${esc(winnerText)}</span>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.openBetModal = function(matchId) {
  const match = matchesCache.find(m => m.id === matchId);
  if (!match) return;

  showModal(`投注 - ${match.team1} vs ${match.team2}`, `
    <p style="margin-bottom:16px;color:var(--text-secondary);font-size:13px;">选择获胜队伍并输入投注积分</p>
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <button class="btn bet-team-btn" data-team="1" style="flex:1;padding:12px;font-size:15px;">${esc(match.team1)}</button>
      <button class="btn bet-team-btn" data-team="2" style="flex:1;padding:12px;font-size:15px;">${esc(match.team2)}</button>
    </div>
    <div class="input-group">
      <label>投注积分</label>
      <input type="number" id="bet-amount" min="1" max="${currentUser.points}" placeholder="最多 ${currentUser.points.toLocaleString()}">
    </div>
    <div style="display:flex;gap:6px;margin-bottom:16px;">
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=100">100</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=500">500</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=1000">1K</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=5000">5K</button>
      <button class="btn btn-sm" onclick="document.getElementById('bet-amount').value=${currentUser.points}">全部</button>
    </div>
    <button class="btn btn-primary btn-full" onclick="submitBet(${matchId})">确认投注</button>
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
    loadMatches();
  } catch (err) {
    showToast(err.message, true);
  }
};

// ==================== TOURNAMENTS ====================
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
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">暂无锦标赛</div>';
    return;
  }

  const statusMap = { upcoming: '预测中', closed: '已截止', finished: '已结束' };
  const predTypeLabels = {
    champion: '冠军', runner_up: '亚军', third_place: '季军',
    top4: '四强', top8: '八强', qualify: '出线'
  };
  const multipliers = { champion: 20, runner_up: 10, third_place: 7, top4: 4, top8: 3, qualify: 2 };

  list.innerHTML = tournaments.map(t => `
    <div class="card tournament-card">
      <div class="tournament-name">${esc(t.name)}</div>
      <div class="tournament-status">${statusMap[t.status] || t.status}</div>
      <div class="teams-grid">
        ${t.teams.map(team => `
          <div class="team-chip" data-team-id="${team.id}" data-tournament-id="${t.id}">${esc(team.team_name)}</div>
        `).join('')}
      </div>
      ${t.status === 'upcoming' ? `
        <div class="prediction-types">
          ${Object.entries(predTypeLabels).map(([key, label]) => `
            <button class="pred-type-btn" data-type="${key}" data-tournament-id="${t.id}">${label} x${multipliers[key]}</button>
          `).join('')}
        </div>
        <button class="btn btn-primary btn-full" style="margin-top:12px;" onclick="openPredictModal(${t.id})">提交预测</button>
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
    <p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">
      预测类型: <strong style="color:var(--accent);">${predLabels[selectedPredType]}</strong> (倍率 x${multipliers[selectedPredType]})
    </p>
    <div class="input-group">
      <label>投注积分</label>
      <input type="number" id="pred-amount" min="1" max="${currentUser.points}" placeholder="最多 ${currentUser.points.toLocaleString()}">
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">
      猜对可获得 投注额 × ${multipliers[selectedPredType]} 积分
    </p>
    <button class="btn btn-primary btn-full" onclick="submitPredict(${tournamentId})">确认预测</button>
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

// ==================== MY BETS ====================
async function loadMyBets() {
  try {
    const [bets, predictions] = await Promise.all([
      api('/api/my-bets'),
      api('/api/my-predictions')
    ]);
    renderMyBets(bets, predictions);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderMyBets(bets, predictions) {
  const betsList = document.getElementById('my-bets-list');
  const predsList = document.getElementById('my-predictions-list');

  if (bets.length === 0) {
    betsList.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">暂无比赛投注</div>';
  } else {
    betsList.innerHTML = bets.map(b => {
      const betTeam = b.bet_team === 1 ? b.team1 : b.team2;
      const statusMap = { pending: '待结算', won: '已赢', lost: '已输' };
      const statusClass = 'bet-status-' + b.status;
      return `
        <div class="card bet-card">
          <div class="bet-info">
            <div class="bet-match">${esc(b.team1)} vs ${esc(b.team2)}</div>
            <div class="bet-detail">
              投注: ${esc(betTeam)} | <span class="${statusClass}">${statusMap[b.status]}</span>
              ${b.tournament_name ? ` | ${esc(b.tournament_name)}` : ''}
            </div>
          </div>
          <div class="bet-amount">
            <div class="amount">${b.amount.toLocaleString()}</div>
            ${b.status === 'won' ? `<div class="payout">+${b.payout.toLocaleString()}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  if (predictions.length === 0) {
    predsList.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">暂无锦标赛预测</div>';
  } else {
    const predLabels = {
      champion: '冠军', runner_up: '亚军', third_place: '季军',
      top4: '四强', top8: '八强', qualify: '出线'
    };
    predsList.innerHTML = predictions.map(p => {
      const statusMap = { pending: '待结算', won: '已赢', lost: '已输' };
      const statusClass = 'bet-status-' + p.status;
      return `
        <div class="card bet-card">
          <div class="bet-info">
            <div class="bet-match">${esc(p.tournament_name)}</div>
            <div class="bet-detail">
              ${predLabels[p.prediction_type]}: ${esc(p.team_name)} | <span class="${statusClass}">${statusMap[p.status]}</span>
            </div>
          </div>
          <div class="bet-amount">
            <div class="amount">${p.bet_amount.toLocaleString()}</div>
            ${p.status === 'won' ? `<div class="payout">+${p.payout.toLocaleString()}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

// ==================== LEADERBOARD ====================
async function loadLeaderboard() {
  try {
    const users = await api('/api/leaderboard');
    renderLeaderboard(users);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderLeaderboard(users) {
  const list = document.getElementById('leaderboard-list');
  if (users.length === 0) {
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">暂无数据</div>';
    return;
  }

  list.innerHTML = '<div class="leaderboard">' + users.map((u, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? ' top' + rank : '';
    const medal = rank === 1 ? '&#129351;' : rank === 2 ? '&#129352;' : rank === 3 ? '&#129353;' : '';
    return `
      <div class="lb-row">
        <div class="lb-rank${rankClass}">${medal || rank}</div>
        <div class="lb-name">${esc(u.username)}</div>
        <div class="lb-points">${u.points.toLocaleString()}</div>
      </div>
    `;
  }).join('') + '</div>';
}

// ==================== UTILS ====================
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatTime(t) {
  if (!t) return '';
  try {
    const iso = t.includes('T') ? t : t.replace(' ', 'T');
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return t;
  }
}

// ==================== INIT ====================
loadUser();

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
