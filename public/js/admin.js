// ==================== CONFIG ====================
// CloudBase部署时，把这里改成你的云函数API地址
// 例如：const API_BASE = 'https://service-xxxxx@shanghai.apigw.tencentcs.com/release';
// 如果配置了API网关路由，保持空字符串即可
const API_BASE = '';

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
    document.getElementById('admin-auth').classList.add('active');
    document.getElementById('admin-dashboard').classList.remove('active');
    throw new Error('请重新登录');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ==================== TOAST ====================
function showToast(msg, isError = false) {
  const toast = document.getElementById('admin-toast');
  toast.textContent = msg;
  toast.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==================== MODAL ====================
function showModal(title, bodyHtml) {
  document.getElementById('admin-modal-title').textContent = title;
  document.getElementById('admin-modal-body').innerHTML = bodyHtml;
  document.getElementById('admin-modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('admin-modal-overlay').classList.remove('active');
}

document.getElementById('admin-modal-close').addEventListener('click', closeModal);
document.getElementById('admin-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ==================== AUTH ====================
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('admin-auth-error');
  errEl.textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: {
        username: document.getElementById('admin-username').value,
        password: document.getElementById('admin-password').value
      }
    });
    if (!data.isAdmin) {
      errEl.textContent = '该账号不是管理员';
      return;
    }
    setToken(data.token);
    showToast('登录成功');
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('admin-logout-btn').addEventListener('click', () => {
  clearToken();
  document.getElementById('admin-auth').classList.add('active');
  document.getElementById('admin-dashboard').classList.remove('active');
});

async function checkAdmin() {
  if (!getToken()) return;
  try {
    const user = await api('/api/me');
    if (user.is_admin) {
      showDashboard();
    }
  } catch {}
}

function showDashboard() {
  document.getElementById('admin-auth').classList.remove('active');
  document.getElementById('admin-dashboard').classList.add('active');
  loadAdminMatches();
}

// ==================== TABS ====================
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + tab.dataset.page).classList.add('active');

    if (tab.dataset.page === 'admin-matches') loadAdminMatches();
    else if (tab.dataset.page === 'admin-tournaments') loadAdminTournaments();
    else if (tab.dataset.page === 'admin-users') loadAdminUsers();
  });
});

// ==================== MATCHES ====================
const addMatchForm = document.getElementById('add-match-form');
document.getElementById('add-match-btn').addEventListener('click', () => {
  addMatchForm.classList.toggle('hidden');
});
document.getElementById('cancel-match-btn').addEventListener('click', () => {
  addMatchForm.classList.add('hidden');
});

document.getElementById('save-match-btn').addEventListener('click', async () => {
  const team1 = document.getElementById('new-team1').value.trim();
  const team2 = document.getElementById('new-team2').value.trim();
  const matchTime = document.getElementById('new-match-time').value;
  const tournamentName = document.getElementById('new-tournament-name').value.trim();

  if (!team1 || !team2) { showToast('请填写队伍名称', true); return; }

  try {
    await api('/api/admin/matches', {
      method: 'POST',
      body: { team1, team2, matchTime, tournamentName }
    });
    showToast('比赛已创建');
    addMatchForm.classList.add('hidden');
    document.getElementById('new-team1').value = '';
    document.getElementById('new-team2').value = '';
    document.getElementById('new-match-time').value = '';
    document.getElementById('new-tournament-name').value = '';
    loadAdminMatches();
  } catch (err) {
    showToast(err.message, true);
  }
});

async function loadAdminMatches() {
  try {
    const matches = await api('/api/matches');
    renderAdminMatches(matches);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderAdminMatches(matches) {
  const list = document.getElementById('admin-matches-list');
  const statusMap = { upcoming: '待开始', betting: '进行中', finished: '已结束' };

  if (matches.length === 0) {
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">暂无比赛</div>';
    return;
  }

  list.innerHTML = matches.map(m => `
    <div class="card">
      <div class="match-header">
        <span class="match-tournament">${esc(m.tournament_name || '友谊赛')}</span>
        <span class="match-status status-${m.status}">${statusMap[m.status]}</span>
      </div>
      <div class="match-teams">
        <div class="team-name">${esc(m.team1)}</div>
        <div class="vs-text">VS</div>
        <div class="team-name">${esc(m.team2)}</div>
      </div>
      ${m.match_time ? `<div class="match-time">${formatTime(m.match_time)}</div>` : ''}
      <div class="match-actions">
        ${m.status === 'upcoming' ? `
          <button class="btn btn-primary btn-sm" onclick="startMatch(${m.id})">开始比赛</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMatch(${m.id})">删除</button>
        ` : ''}
        ${m.status === 'betting' ? `
          <button class="btn btn-success btn-sm" onclick="resolveMatch(${m.id}, 1)">${esc(m.team1)} 胜</button>
          <button class="btn btn-success btn-sm" onclick="resolveMatch(${m.id}, 2)">${esc(m.team2)} 胜</button>
        ` : ''}
        ${m.status === 'finished' ? `
          <span style="font-size:12px;color:var(--text-muted);">胜者: ${esc(m.winner === 1 ? m.team1 : m.team2)}</span>
        ` : ''}
      </div>
    </div>
  `).join('');
}

window.startMatch = async function(id) {
  if (!confirm('确认开始此比赛？开始后用户将无法投注。')) return;
  try {
    await api(`/api/admin/matches/${id}/start`, { method: 'POST' });
    showToast('比赛已开始');
    loadAdminMatches();
  } catch (err) { showToast(err.message, true); }
};

window.resolveMatch = async function(id, winner) {
  if (!confirm('确认结算此比赛？')) return;
  try {
    const data = await api(`/api/admin/matches/${id}/resolve`, {
      method: 'POST',
      body: { winner }
    });
    showToast(data.message);
    loadAdminMatches();
  } catch (err) { showToast(err.message, true); }
};

window.deleteMatch = async function(id) {
  if (!confirm('确认删除此比赛？相关投注将被退还。')) return;
  try {
    await api(`/api/admin/matches/${id}`, { method: 'DELETE' });
    showToast('比赛已删除');
    loadAdminMatches();
  } catch (err) { showToast(err.message, true); }
};

// ==================== TOURNAMENTS ====================
const addTournamentForm = document.getElementById('add-tournament-form');
document.getElementById('add-tournament-btn').addEventListener('click', () => {
  addTournamentForm.classList.toggle('hidden');
});
document.getElementById('cancel-tournament-btn').addEventListener('click', () => {
  addTournamentForm.classList.add('hidden');
});

document.getElementById('save-tournament-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-tournament-name-input').value.trim();
  const teamsText = document.getElementById('new-tournament-teams').value.trim();
  const teams = teamsText.split('\n').map(t => t.trim()).filter(t => t);

  if (!name) { showToast('请填写锦标赛名称', true); return; }
  if (teams.length < 2) { showToast('至少需要2支队伍', true); return; }

  try {
    await api('/api/admin/tournaments', {
      method: 'POST',
      body: { name, teams }
    });
    showToast('锦标赛已创建');
    addTournamentForm.classList.add('hidden');
    document.getElementById('new-tournament-name-input').value = '';
    document.getElementById('new-tournament-teams').value = '';
    loadAdminTournaments();
  } catch (err) { showToast(err.message, true); }
});

async function loadAdminTournaments() {
  try {
    const tournaments = await api('/api/tournaments');
    renderAdminTournaments(tournaments);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderAdminTournaments(tournaments) {
  const list = document.getElementById('admin-tournaments-list');
  const statusMap = { upcoming: '预测中', closed: '已截止', finished: '已结束' };

  if (tournaments.length === 0) {
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);">暂无锦标赛</div>';
    return;
  }

  list.innerHTML = tournaments.map(t => `
    <div class="card tournament-card">
      <div class="tournament-name">${esc(t.name)}</div>
      <div class="tournament-status">${statusMap[t.status]}</div>
      <div class="teams-grid">
        ${t.teams.map(team => `<div class="team-chip" style="cursor:default;">${esc(team.team_name)}</div>`).join('')}
      </div>
      <div class="match-actions" style="margin-top:12px;">
        ${t.status === 'upcoming' ? `
          <button class="btn btn-primary btn-sm" onclick="closeTournament(${t.id})">截止预测</button>
          <button class="btn btn-sm" onclick="openResolveTournament(${t.id})">结算</button>
        ` : ''}
        ${t.status === 'closed' ? `
          <button class="btn btn-primary btn-sm" onclick="openResolveTournament(${t.id})">结算</button>
        ` : ''}
        ${t.status === 'finished' ? `
          <span style="font-size:12px;color:var(--text-muted);">已结算</span>
        ` : ''}
      </div>
    </div>
  `).join('');
}

window.closeTournament = async function(id) {
  if (!confirm('确认截止此锦标赛的预测？')) return;
  try {
    await api(`/api/admin/tournaments/${id}/close`, { method: 'POST' });
    showToast('预测已截止');
    loadAdminTournaments();
  } catch (err) { showToast(err.message, true); }
};

window.openResolveTournament = function(id) {
  showModal('结算锦标赛', `
    <p style="margin-bottom:16px;color:var(--text-secondary);font-size:13px;">选择各类别的获胜队伍（可留空跳过）</p>
    <div id="resolve-form">
      <div class="input-group">
        <label>冠军 (x20)</label>
        <select id="resolve-champion"><option value="">-- 选择 --</option></select>
      </div>
      <div class="input-group">
        <label>亚军 (x10)</label>
        <select id="resolve-runner-up"><option value="">-- 选择 --</option></select>
      </div>
      <div class="input-group">
        <label>季军 (x7)</label>
        <select id="resolve-third-place"><option value="">-- 选择 --</option></select>
      </div>
      <div class="input-group">
        <label>四强 (x4) - 可多选</label>
        <select id="resolve-top4" multiple size="4"></select>
      </div>
      <div class="input-group">
        <label>八强 (x3) - 可多选</label>
        <select id="resolve-top8" multiple size="4"></select>
      </div>
      <div class="input-group">
        <label>出线 (x2) - 可多选</label>
        <select id="resolve-qualify" multiple size="4"></select>
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="submitResolve(${id})">确认结算</button>
  `);

  loadTournamentTeamsForResolve(id);
};

async function loadTournamentTeamsForResolve(tournamentId) {
  try {
    const t = await api(`/api/tournaments/${tournamentId}`);
    const options = t.teams.map(team => `<option value="${team.id}">${esc(team.team_name)}</option>`).join('');
    ['resolve-champion', 'resolve-runner-up', 'resolve-third-place', 'resolve-top4', 'resolve-top8', 'resolve-qualify'].forEach(id => {
      const sel = document.getElementById(id);
      sel.innerHTML = sel.multiple ? options : '<option value="">-- 选择 --</option>' + options;
    });
  } catch {}
}

window.submitResolve = async function(tournamentId) {
  const getVal = (id) => document.getElementById(id).value || null;
  const getMulti = (id) => Array.from(document.getElementById(id).selectedOptions).map(o => parseInt(o.value));

  const body = {
    champion: getVal('resolve-champion') ? parseInt(getVal('resolve-champion')) : null,
    runnerUp: getVal('resolve-runner-up') ? parseInt(getVal('resolve-runner-up')) : null,
    thirdPlace: getVal('resolve-third-place') ? parseInt(getVal('resolve-third-place')) : null,
    top4: getMulti('resolve-top4'),
    top8: getMulti('resolve-top8'),
    qualify: getMulti('resolve-qualify')
  };

  if (!confirm('确认结算？此操作不可撤销。')) return;

  try {
    await api(`/api/admin/tournaments/${tournamentId}/resolve`, {
      method: 'POST',
      body
    });
    showToast('锦标赛已结算');
    closeModal();
    loadAdminTournaments();
  } catch (err) { showToast(err.message, true); }
};

// ==================== USERS ====================
async function loadAdminUsers() {
  try {
    const users = await api('/api/admin/users');
    renderAdminUsers(users);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderAdminUsers(users) {
  const list = document.getElementById('admin-users-list');
  list.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>用户名</th>
          <th>积分</th>
          <th>注册时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td>${u.id}</td>
            <td>${esc(u.username)} ${u.is_admin ? '<span style="color:var(--accent);font-size:11px;">[管理员]</span>' : ''}</td>
            <td>
              ${u.is_admin ? '<span style="color:var(--text-muted);">--</span>' : `
                <input type="number" value="${u.points}" id="points-${u.id}" min="0">
              `}
            </td>
            <td style="font-size:12px;color:var(--text-muted);">${formatTime(u.created_at)}</td>
            <td>
              ${u.is_admin ? '' : `
                <button class="btn btn-sm btn-primary" onclick="updatePoints(${u.id})">保存</button>
                <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">删除</button>
              `}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.updatePoints = async function(userId) {
  const points = parseInt(document.getElementById(`points-${userId}`).value);
  if (isNaN(points) || points < 0) { showToast('无效积分数', true); return; }
  try {
    await api(`/api/admin/users/${userId}/points`, {
      method: 'POST',
      body: { points }
    });
    showToast('积分已更新');
  } catch (err) { showToast(err.message, true); }
};

window.deleteUser = async function(userId) {
  if (!confirm('确认删除此用户？所有投注记录将被清除。')) return;
  try {
    await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    showToast('用户已删除');
    loadAdminUsers();
  } catch (err) { showToast(err.message, true); }
};

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
checkAdmin();
