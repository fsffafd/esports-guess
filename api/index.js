const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { initDb, queryAll, queryOne, runSql } = require('../db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'esports-guess-secret-2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function signToken(user) {
  return jwt.sign(
    { userId: user.id, isAdmin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '请先登录' });
    }
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '请先登录' });
    }
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    const user = await queryOne('SELECT is_admin FROM users WHERE id = ?', [decoded.userId]);
    if (!user || !user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// ==================== AUTH ====================

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (username.length < 2) return res.status(400).json({ error: '用户名至少2个字符' });
    if (password.length < 4) return res.status(400).json({ error: '密码至少4个字符' });

    const existing = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: '用户名已存在' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await runSql('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);
    const token = jwt.sign({ userId: result.lastInsertRowid, isAdmin: false }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: '注册成功', token, userId: result.lastInsertRowid, isAdmin: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

    const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = signToken(user);
    res.json({ message: '登录成功', token, userId: user.id, isAdmin: !!user.is_admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await queryOne('SELECT id, username, points, is_admin, created_at FROM users WHERE id = ?', [req.userId]);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MATCHES ====================

app.get('/api/matches', requireAuth, async (req, res) => {
  try {
    const status = req.query.status;
    let matches;
    if (status) {
      matches = await queryAll('SELECT * FROM matches WHERE status = ? ORDER BY match_time DESC', [status]);
    } else {
      matches = await queryAll('SELECT * FROM matches ORDER BY match_time DESC');
    }
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/matches/:id', requireAuth, async (req, res) => {
  try {
    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== BETTING ====================

app.post('/api/bet', requireAuth, async (req, res) => {
  try {
    const { matchId, betTeam, amount } = req.body;
    if (!matchId || !betTeam || !amount) return res.status(400).json({ error: '参数不完整' });
    if (amount <= 0) return res.status(400).json({ error: '投注金额必须大于0' });

    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [matchId]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    if (match.status !== 'upcoming') return res.status(400).json({ error: '比赛已开始或已结束，无法投注' });

    const user = await queryOne('SELECT points FROM users WHERE id = ?', [req.userId]);
    if (user.points < amount) return res.status(400).json({ error: '积分不足' });

    const existingBet = await queryOne('SELECT id FROM bets WHERE user_id = ? AND match_id = ?', [req.userId, matchId]);
    if (existingBet) return res.status(400).json({ error: '您已经对本场比赛下过注了' });

    await runSql('UPDATE users SET points = points - ? WHERE id = ?', [amount, req.userId]);
    await runSql('INSERT INTO bets (user_id, match_id, bet_team, amount) VALUES (?, ?, ?, ?)', [req.userId, matchId, betTeam, amount]);

    const updatedUser = await queryOne('SELECT points FROM users WHERE id = ?', [req.userId]);
    res.json({ message: '投注成功', remainingPoints: updatedUser.points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/my-bets', requireAuth, async (req, res) => {
  try {
    const bets = await queryAll(`
      SELECT b.*, m.team1, m.team2, m.status as match_status, m.match_time, m.tournament_name
      FROM bets b JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = ? ORDER BY b.created_at DESC
    `, [req.userId]);
    res.json(bets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TOURNAMENTS ====================

app.get('/api/tournaments', requireAuth, async (req, res) => {
  try {
    const tournaments = await queryAll('SELECT * FROM tournaments ORDER BY created_at DESC');
    for (const t of tournaments) {
      t.teams = await queryAll('SELECT * FROM tournament_teams WHERE tournament_id = ?', [t.id]);
    }
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tournaments/:id', requireAuth, async (req, res) => {
  try {
    const tournament = await queryOne('SELECT * FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) return res.status(404).json({ error: '锦标赛不存在' });
    tournament.teams = await queryAll('SELECT * FROM tournament_teams WHERE tournament_id = ?', [tournament.id]);
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const MULTIPLIERS = {
  champion: 20,
  runner_up: 10,
  third_place: 7,
  top4: 4,
  top8: 3,
  qualify: 2
};

app.post('/api/predict', requireAuth, async (req, res) => {
  try {
    const { tournamentId, predictionType, teamId, betAmount } = req.body;
    if (!tournamentId || !predictionType || !teamId || !betAmount) return res.status(400).json({ error: '参数不完整' });
    if (!MULTIPLIERS[predictionType]) return res.status(400).json({ error: '无效的预测类型' });
    if (betAmount <= 0) return res.status(400).json({ error: '投注金额必须大于0' });

    const tournament = await queryOne('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);
    if (!tournament) return res.status(404).json({ error: '锦标赛不存在' });
    if (tournament.status !== 'upcoming') return res.status(400).json({ error: '该锦标赛已截止预测' });

    const team = await queryOne('SELECT * FROM tournament_teams WHERE id = ? AND tournament_id = ?', [teamId, tournamentId]);
    if (!team) return res.status(404).json({ error: '队伍不存在' });

    const user = await queryOne('SELECT points FROM users WHERE id = ?', [req.userId]);
    if (user.points < betAmount) return res.status(400).json({ error: '积分不足' });

    const existing = await queryOne('SELECT id FROM tournament_predictions WHERE user_id = ? AND tournament_id = ? AND prediction_type = ?', [req.userId, tournamentId, predictionType]);
    if (existing) return res.status(400).json({ error: '您已经做过此类型的预测了' });

    await runSql('UPDATE users SET points = points - ? WHERE id = ?', [betAmount, req.userId]);
    await runSql('INSERT INTO tournament_predictions (user_id, tournament_id, prediction_type, team_id, bet_amount) VALUES (?, ?, ?, ?, ?)', [req.userId, tournamentId, predictionType, teamId, betAmount]);

    const updatedUser = await queryOne('SELECT points FROM users WHERE id = ?', [req.userId]);
    res.json({ message: '预测成功', multiplier: MULTIPLIERS[predictionType], remainingPoints: updatedUser.points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/my-predictions', requireAuth, async (req, res) => {
  try {
    const predictions = await queryAll(`
      SELECT tp.*, t.name as tournament_name, t.status as tournament_status,
             tt.team_name
      FROM tournament_predictions tp
      JOIN tournaments t ON tp.tournament_id = t.id
      JOIN tournament_teams tt ON tp.team_id = tt.id
      WHERE tp.user_id = ? ORDER BY tp.created_at DESC
    `, [req.userId]);
    res.json(predictions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== LEADERBOARD ====================

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const users = await queryAll('SELECT id, username, points, created_at FROM users WHERE is_admin = 0 ORDER BY points DESC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ADMIN ====================

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await queryAll('SELECT id, username, points, is_admin, created_at FROM users ORDER BY points DESC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/points', requireAdmin, async (req, res) => {
  try {
    const { points } = req.body;
    if (points === undefined || points < 0) return res.status(400).json({ error: '无效的积分数' });
    await runSql('UPDATE users SET points = ? WHERE id = ? AND is_admin = 0', [points, req.params.id]);
    res.json({ message: '积分已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/matches', requireAdmin, async (req, res) => {
  try {
    const { team1, team2, matchTime, tournamentName } = req.body;
    if (!team1 || !team2) return res.status(400).json({ error: '队伍名称不能为空' });
    const result = await runSql('INSERT INTO matches (team1, team2, match_time, tournament_name) VALUES (?, ?, ?, ?)', [team1, team2, matchTime || null, tournamentName || '']);
    res.json({ message: '比赛已创建', matchId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/matches/:id', requireAdmin, async (req, res) => {
  try {
    const { team1, team2, matchTime, tournamentName } = req.body;
    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    await runSql('UPDATE matches SET team1 = ?, team2 = ?, match_time = ?, tournament_name = ? WHERE id = ?',
      [team1 || match.team1, team2 || match.team2, matchTime || match.match_time, tournamentName !== undefined ? tournamentName : match.tournament_name, req.params.id]);
    res.json({ message: '比赛已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/matches/:id', requireAdmin, async (req, res) => {
  try {
    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    if (match.status === 'betting' || match.status === 'finished') {
      const bets = await queryAll('SELECT * FROM bets WHERE match_id = ?', [req.params.id]);
      for (const bet of bets) {
        if (bet.status === 'pending') {
          await runSql('UPDATE users SET points = points + ? WHERE id = ?', [bet.amount, bet.user_id]);
        }
      }
      await runSql('DELETE FROM bets WHERE match_id = ?', [req.params.id]);
    }
    await runSql('DELETE FROM matches WHERE id = ?', [req.params.id]);
    res.json({ message: '比赛已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/matches/:id/start', requireAdmin, async (req, res) => {
  try {
    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    if (match.status !== 'upcoming') return res.status(400).json({ error: '只有待开始的比赛可以开赛' });
    await runSql('UPDATE matches SET status = ? WHERE id = ?', ['betting', req.params.id]);
    res.json({ message: '比赛已开始，投注已截止' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/matches/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const { winner } = req.body;
    if (winner !== 1 && winner !== 2) return res.status(400).json({ error: '请选择获胜队伍' });

    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    if (match.status !== 'betting') return res.status(400).json({ error: '只有进行中的比赛可以结算' });

    const bets = await queryAll('SELECT * FROM bets WHERE match_id = ?', [req.params.id]);
    const totalPool = bets.reduce((sum, b) => sum + b.amount, 0);
    const winnerBets = bets.filter(b => b.bet_team === winner);
    const winnerTotal = winnerBets.reduce((sum, b) => sum + b.amount, 0);

    for (const bet of bets) {
      if (bet.bet_team === winner) {
        const payout = winnerTotal > 0 ? Math.floor((bet.amount / winnerTotal) * totalPool) : 0;
        await runSql('UPDATE bets SET status = ?, payout = ? WHERE id = ?', ['won', payout, bet.id]);
        if (payout > 0) await runSql('UPDATE users SET points = points + ? WHERE id = ?', [payout, bet.user_id]);
      } else {
        await runSql('UPDATE bets SET status = ?, payout = 0 WHERE id = ?', ['lost', 0, bet.id]);
      }
    }
    await runSql('UPDATE matches SET status = ?, winner = ? WHERE id = ?', ['finished', winner, req.params.id]);

    const winnerTeam = winner === 1 ? match.team1 : match.team2;
    res.json({ message: `比赛已结算，${winnerTeam} 获胜`, totalPool, winnerCount: winnerBets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/tournaments', requireAdmin, async (req, res) => {
  try {
    const { name, teams } = req.body;
    if (!name) return res.status(400).json({ error: '锦标赛名称不能为空' });
    if (!teams || teams.length < 2) return res.status(400).json({ error: '至少需要2支队伍' });

    const result = await runSql('INSERT INTO tournaments (name) VALUES (?)', [name]);
    const tid = result.lastInsertRowid;
    for (const teamName of teams) {
      await runSql('INSERT INTO tournament_teams (tournament_id, team_name) VALUES (?, ?)', [tid, teamName.trim()]);
    }
    res.json({ message: '锦标赛已创建', tournamentId: tid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/tournaments/:id/close', requireAdmin, async (req, res) => {
  try {
    await runSql('UPDATE tournaments SET status = ? WHERE id = ?', ['closed', req.params.id]);
    res.json({ message: '锦标赛预测已截止' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/tournaments/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const { champion, runnerUp, thirdPlace, top4, top8, qualify } = req.body;
    const tournament = await queryOne('SELECT * FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) return res.status(404).json({ error: '锦标赛不存在' });

    const results = { champion, runner_up: runnerUp, third_place: thirdPlace, top4, top8, qualify };

    for (const [type, teamIds] of Object.entries(results)) {
      if (!teamIds || !MULTIPLIERS[type]) continue;
      const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
      for (const teamId of ids) {
        const predictions = await queryAll('SELECT * FROM tournament_predictions WHERE tournament_id = ? AND prediction_type = ? AND team_id = ?', [req.params.id, type, teamId]);
        for (const pred of predictions) {
          const payout = pred.bet_amount * MULTIPLIERS[type];
          await runSql('UPDATE tournament_predictions SET status = ?, payout = ? WHERE id = ?', ['won', payout, pred.id]);
          await runSql('UPDATE users SET points = points + ? WHERE id = ?', [payout, pred.user_id]);
        }
        const pendingPreds = await queryAll('SELECT * FROM tournament_predictions WHERE tournament_id = ? AND prediction_type = ? AND status = ?', [req.params.id, type, 'pending']);
        for (const pred of pendingPreds) {
          await runSql('UPDATE tournament_predictions SET status = ?, payout = 0 WHERE id = ?', ['lost', pred.id]);
        }
      }
    }
    await runSql('UPDATE tournaments SET status = ? WHERE id = ?', ['finished', req.params.id]);
    res.json({ message: '锦标赛已结算' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await queryOne('SELECT is_admin FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.is_admin) return res.status(400).json({ error: '不能删除管理员' });
    await runSql('DELETE FROM bets WHERE user_id = ?', [req.params.id]);
    await runSql('DELETE FROM tournament_predictions WHERE user_id = ?', [req.params.id]);
    await runSql('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: '用户已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

let initialized = false;
async function ensureInit() {
  if (!initialized) {
    await initDb();
    initialized = true;
  }
}

module.exports.app = app;
module.exports = async (req, res) => {
  await ensureInit();
  return app(req, res);
};
module.exports.app = app;
