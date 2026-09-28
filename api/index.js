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

function getBeijingToday() {
  const now = new Date();
  const beijing = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const y = beijing.getFullYear();
  const m = String(beijing.getMonth() + 1).padStart(2, '0');
  const d = String(beijing.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getBeijingDateRange(dateStr) {
  return {
    start: `${dateStr}T00:00:00+08:00`,
    end: `${dateStr}T23:59:59.999+08:00`
  };
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
    const { date, status, tournament } = req.query;
    let sql = 'SELECT * FROM matches WHERE 1=1';
    const params = [];

    if (date) {
      const { start, end } = getBeijingDateRange(date);
      sql += ' AND match_time >= ? AND match_time <= ?';
      params.push(start, end);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (tournament) {
      sql += ' AND tournament_name = ?';
      params.push(tournament);
    }

    sql += ' ORDER BY match_time ASC';
    const matches = await queryAll(sql, params);
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/matches/tournaments-list', requireAuth, async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT DISTINCT tournament_name, COUNT(*) as match_count
      FROM matches
      WHERE tournament_name != '' AND tournament_name IS NOT NULL
      GROUP BY tournament_name
      ORDER BY MIN(match_time) DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/matches/dates', requireAuth, async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT DISTINCT DATE(match_time) as match_date
      FROM matches
      WHERE match_time IS NOT NULL
      ORDER BY match_date ASC
    `);
    const today = getBeijingToday();
    const result = rows.map(r => {
      const ds = r.match_date instanceof Date
        ? r.match_date.toISOString().slice(0, 10)
        : String(r.match_date).slice(0, 10);
      return { date: ds, hasMatches: true, isToday: ds === today };
    });
    res.json(result);
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

    if (match.match_time) {
      const matchTime = new Date(match.match_time);
      const now = new Date();
      const beijingNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      const beijingMatchTime = new Date(matchTime.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      if (beijingMatchTime < beijingNow) {
        return res.status(400).json({ error: '比赛时间已过，无法投注' });
      }
    }

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
      SELECT b.*, m.team1, m.team2, m.status as match_status, m.match_time, m.tournament_name,
             m.bo_format, m.score1, m.score2
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

app.get('/api/leaderboard/overall', requireAuth, async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT
        u.id,
        u.username,
        u.points,
        COALESCE(SUM(CASE WHEN b.status = 'won' THEN b.payout - b.amount WHEN b.status = 'lost' THEN -b.amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN tp.status = 'won' THEN tp.payout - tp.bet_amount WHEN tp.status = 'lost' THEN -tp.bet_amount ELSE 0 END), 0) as total_profit,
        COUNT(DISTINCT b.id) + COUNT(DISTINCT tp.id) as total_bets,
        COUNT(DISTINCT CASE WHEN b.status = 'won' THEN b.id END) + COUNT(DISTINCT CASE WHEN tp.status = 'won' THEN tp.id END) as won_count,
        COUNT(DISTINCT CASE WHEN b.status = 'lost' THEN b.id END) + COUNT(DISTINCT CASE WHEN tp.status = 'lost' THEN tp.id END) as lost_count
      FROM users u
      LEFT JOIN bets b ON b.user_id = u.id
      LEFT JOIN tournament_predictions tp ON tp.user_id = u.id
      WHERE u.is_admin = 0
      GROUP BY u.id, u.username, u.points
      ORDER BY u.points DESC
    `);
    const result = rows.map(r => ({
      id: r.id,
      username: r.username,
      points: r.points,
      totalProfit: Number(r.total_profit) || 0,
      totalBets: Number(r.total_bets) || 0,
      wonCount: Number(r.won_count) || 0,
      lostCount: Number(r.lost_count) || 0
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/stats', requireAuth, async (req, res) => {
  try {
    const user = await queryOne('SELECT id, username, points, created_at FROM users WHERE id = ?', [req.userId]);

    const betStats = await queryOne(`
      SELECT
        COUNT(*) as total_bets,
        COALESCE(SUM(amount), 0) as total_wagered,
        COALESCE(SUM(CASE WHEN status = 'won' THEN payout - amount WHEN status = 'lost' THEN -amount ELSE 0 END), 0) as bet_profit,
        COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
        COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
      FROM bets WHERE user_id = ?
    `, [req.userId]);

    const predStats = await queryOne(`
      SELECT
        COUNT(*) as total_preds,
        COALESCE(SUM(bet_amount), 0) as total_wagered,
        COALESCE(SUM(CASE WHEN status = 'won' THEN payout - bet_amount WHEN status = 'lost' THEN -bet_amount ELSE 0 END), 0) as pred_profit,
        COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
        COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
      FROM tournament_predictions WHERE user_id = ?
    `, [req.userId]);

    const totalBets = Number(betStats.total_bets) + Number(predStats.total_preds);
    const totalWon = Number(betStats.won_count) + Number(predStats.won_count);
    const totalLost = Number(betStats.lost_count) + Number(predStats.lost_count);
    const totalPending = Number(betStats.pending_count) + Number(predStats.pending_count);
    const totalProfit = Number(betStats.bet_profit) + Number(predStats.pred_profit);
    const totalWagered = Number(betStats.total_wagered) + Number(predStats.total_wagered);
    const winRate = (totalWon + totalLost) > 0 ? Math.round((totalWon / (totalWon + totalLost)) * 100) : 0;

    res.json({
      username: user.username,
      points: user.points,
      createdAt: user.created_at,
      totalBets,
      totalWon,
      totalLost,
      totalPending,
      totalProfit,
      totalWagered,
      winRate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leaderboard/daily', requireAuth, async (req, res) => {
  try {
    const today = getBeijingToday();
    const { start, end } = getBeijingDateRange(today);

    const rows = await queryAll(`
      SELECT
        u.id,
        u.username,
        COALESCE(SUM(
          CASE WHEN b.status = 'won' THEN b.payout - b.amount
               WHEN b.status = 'lost' THEN -b.amount
               ELSE 0 END
        ), 0) as bet_profit,
        COALESCE(SUM(
          CASE WHEN tp.status = 'won' THEN tp.payout - tp.bet_amount
               WHEN tp.status = 'lost' THEN -tp.bet_amount
               ELSE 0 END
        ), 0) as pred_profit
      FROM users u
      LEFT JOIN bets b ON b.user_id = u.id AND b.settled_at >= ? AND b.settled_at <= ?
      LEFT JOIN tournament_predictions tp ON tp.user_id = u.id AND tp.settled_at >= ? AND tp.settled_at <= ?
      WHERE u.is_admin = 0
      GROUP BY u.id, u.username
      HAVING (COALESCE(SUM(CASE WHEN b.status IN ('won','lost') THEN 1 ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN tp.status IN ('won','lost') THEN 1 ELSE 0 END), 0)) > 0
      ORDER BY (bet_profit + pred_profit) DESC
    `, [start, end, start, end]);

    const result = rows.map(r => ({
      id: r.id,
      username: r.username,
      dailyProfit: Number(r.bet_profit) + Number(r.pred_profit)
    }));

    res.json({ date: today, rankings: result });
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
    const { team1, team2, matchTime, tournamentName, boFormat } = req.body;
    if (!team1 || !team2) return res.status(400).json({ error: '队伍名称不能为空' });
    const format = boFormat || 'BO3';
    const result = await runSql(
      'INSERT INTO matches (team1, team2, match_time, tournament_name, bo_format) VALUES (?, ?, ?, ?, ?)',
      [team1, team2, matchTime || null, tournamentName || '', format]
    );
    res.json({ message: '比赛已创建', matchId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/matches/update-tournament-name', requireAdmin, async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!newName) return res.status(400).json({ error: '新名称不能为空' });
    let result;
    if (oldName) {
      result = await runSql('UPDATE matches SET tournament_name = ? WHERE tournament_name = ?', [newName, oldName]);
    } else {
      result = await runSql("UPDATE matches SET tournament_name = ? WHERE tournament_name != '' AND tournament_name IS NOT NULL", [newName]);
    }
    res.json({ message: '赛事名称已更新', updated: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/matches/:id', requireAdmin, async (req, res) => {
  try {
    const { team1, team2, matchTime, tournamentName, boFormat, score1, score2, gameScores, status, winner } = req.body;
    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    await runSql(
      `UPDATE matches SET team1 = ?, team2 = ?, match_time = ?, tournament_name = ?,
       bo_format = ?, score1 = ?, score2 = ?, game_scores = ?, status = ?, winner = ? WHERE id = ?`,
      [
        team1 || match.team1, team2 || match.team2,
        matchTime || match.match_time,
        tournamentName !== undefined ? tournamentName : match.tournament_name,
        boFormat || match.bo_format,
        score1 !== undefined ? score1 : match.score1,
        score2 !== undefined ? score2 : match.score2,
        gameScores !== undefined ? gameScores : match.game_scores,
        status !== undefined ? status : match.status,
        winner !== undefined ? winner : match.winner,
        req.params.id
      ]
    );
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
    const { winner, score1, score2, gameScores } = req.body;
    if (winner !== 1 && winner !== 2) return res.status(400).json({ error: '请选择获胜队伍' });

    const match = await queryOne('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: '比赛不存在' });
    if (match.status !== 'betting') return res.status(400).json({ error: '只有进行中的比赛可以结算' });

    const now = new Date().toISOString();

    const bets = await queryAll('SELECT * FROM bets WHERE match_id = ?', [req.params.id]);
    const totalPool = bets.reduce((sum, b) => sum + b.amount, 0);
    const winnerBets = bets.filter(b => b.bet_team === winner);
    const winnerTotal = winnerBets.reduce((sum, b) => sum + b.amount, 0);

    for (const bet of bets) {
      if (bet.bet_team === winner) {
        const payout = winnerTotal > 0 ? Math.floor((bet.amount / winnerTotal) * totalPool) : 0;
        await runSql('UPDATE bets SET status = ?, payout = ?, settled_at = ? WHERE id = ?', ['won', payout, now, bet.id]);
        if (payout > 0) await runSql('UPDATE users SET points = points + ? WHERE id = ?', [payout, bet.user_id]);
      } else {
        await runSql('UPDATE bets SET status = ?, payout = 0, settled_at = ? WHERE id = ?', ['lost', now, bet.id]);
      }
    }

    const s1 = score1 !== undefined ? score1 : (winner === 1 ? 2 : 0);
    const s2 = score2 !== undefined ? score2 : (winner === 2 ? 2 : 0);
    const gs = gameScores || '';

    await runSql(
      'UPDATE matches SET status = ?, winner = ?, score1 = ?, score2 = ?, game_scores = ? WHERE id = ?',
      ['finished', winner, s1, s2, gs, req.params.id]
    );

    const winnerTeam = winner === 1 ? match.team1 : match.team2;
    res.json({
      message: `比赛已结算，${winnerTeam} 获胜`,
      totalPool,
      winnerCount: winnerBets.length,
      settledAt: now
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/tournaments/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '锦标赛名称不能为空' });
    const tournament = await queryOne('SELECT * FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) return res.status(404).json({ error: '锦标赛不存在' });
    await runSql('UPDATE tournaments SET name = ? WHERE id = ?', [name, req.params.id]);
    res.json({ message: '锦标赛名称已更新' });
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

    const now = new Date().toISOString();
    const results = { champion, runner_up: runnerUp, third_place: thirdPlace, top4, top8, qualify };

    for (const [type, teamIds] of Object.entries(results)) {
      if (!teamIds || !MULTIPLIERS[type]) continue;
      const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
      for (const teamId of ids) {
        const predictions = await queryAll('SELECT * FROM tournament_predictions WHERE tournament_id = ? AND prediction_type = ? AND team_id = ?', [req.params.id, type, teamId]);
        for (const pred of predictions) {
          const payout = pred.bet_amount * MULTIPLIERS[type];
          await runSql('UPDATE tournament_predictions SET status = ?, payout = ?, settled_at = ? WHERE id = ?', ['won', payout, now, pred.id]);
          await runSql('UPDATE users SET points = points + ? WHERE id = ?', [payout, pred.user_id]);
        }
        const pendingPreds = await queryAll('SELECT * FROM tournament_predictions WHERE tournament_id = ? AND prediction_type = ? AND status = ?', [req.params.id, type, 'pending']);
        for (const pred of pendingPreds) {
          await runSql('UPDATE tournament_predictions SET status = ?, payout = 0, settled_at = ? WHERE id = ?', ['lost', now, pred.id]);
        }
      }
    }
    await runSql('UPDATE tournaments SET status = ? WHERE id = ?', ['finished', req.params.id]);
    res.json({ message: '锦标赛已结算', settledAt: now });
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
