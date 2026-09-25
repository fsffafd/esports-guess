const tcb = require('@cloudbase/node-sdk');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = tcb.init({ env: tcb.SYMBOL_CURRENT });
const db = app.database();
const _ = db.command;

const JWT_SECRET = process.env.JWT_SECRET || 'esports-guess-secret-2026';

const MULTIPLIERS = {
  champion: 20,
  runner_up: 10,
  third_place: 7,
  top4: 4,
  top8: 3,
  qualify: 2
};

function jsonResp(statusCode, data) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    },
    body: JSON.stringify(data)
  };
}

function signToken(user) {
  return jwt.sign(
    { userId: user._id, isAdmin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function verifyAuth(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    return decoded.userId;
  } catch {
    return null;
  }
}

async function verifyAdmin(event) {
  const userId = await verifyAuth(event);
  if (!userId) return null;
  
  const userResult = await db.collection('users').doc(userId).get();
  const user = userResult.data;
  if (!user || !user.is_admin) return null;
  
  return userId;
}

exports.main = async (event, context) => {
  const method = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.requestContext?.http?.path;
  const body = event.body ? JSON.parse(event.body) : {};
  const query = event.queryStringParameters || {};
  
  try {
    // ==================== AUTH ====================
    
    if (path === '/api/register' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return jsonResp(400, { error: '用户名和密码不能为空' });
      if (username.length < 2) return jsonResp(400, { error: '用户名至少2个字符' });
      if (password.length < 4) return jsonResp(400, { error: '密码至少4个字符' });

      const existing = await db.collection('users').where({ username }).limit(1).get();
      if (existing.data.length > 0) return jsonResp(400, { error: '用户名已存在' });

      const hash = bcrypt.hashSync(password, 10);
      const result = await db.collection('users').add({
        username,
        password: hash,
        points: 10000,
        is_admin: 0,
        created_at: new Date()
      });
      
      const token = jwt.sign({ userId: result.id, isAdmin: false }, JWT_SECRET, { expiresIn: '7d' });
      return jsonResp(200, { message: '注册成功', token, userId: result.id, isAdmin: false });
    }
    
    if (path === '/api/login' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return jsonResp(400, { error: '用户名和密码不能为空' });

      const userResult = await db.collection('users').where({ username }).limit(1).get();
      const user = userResult.data[0];
      
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return jsonResp(401, { error: '用户名或密码错误' });
      }

      const token = signToken(user);
      return jsonResp(200, { message: '登录成功', token, userId: user._id, isAdmin: !!user.is_admin });
    }
    
    if (path === '/api/me' && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const userResult = await db.collection('users').doc(userId).get();
      const user = userResult.data;
      return jsonResp(200, {
        id: user._id,
        username: user.username,
        points: user.points,
        is_admin: user.is_admin,
        created_at: user.created_at
      });
    }
    
    // ==================== MATCHES ====================
    
    if (path === '/api/matches' && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      let queryBuilder = db.collection('matches');
      if (query.status) {
        queryBuilder = queryBuilder.where({ status: query.status });
      }
      
      const result = await queryBuilder.orderBy('created_at', 'desc').limit(100).get();
      const matches = result.data.map(m => ({ ...m, id: m._id }));
      return jsonResp(200, matches);
    }
    
    if (path.startsWith('/api/matches/') && path.split('/').length === 4 && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const matchId = path.split('/')[3];
      const matchResult = await db.collection('matches').doc(matchId).get();
      if (!matchResult.data) return jsonResp(404, { error: '比赛不存在' });
      
      const match = { ...matchResult.data, id: matchResult.data._id };
      return jsonResp(200, match);
    }
    
    // ==================== BETTING ====================
    
    if (path === '/api/bet' && method === 'POST') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const { matchId, betTeam, amount } = body;
      if (!matchId || !betTeam || !amount) return jsonResp(400, { error: '参数不完整' });
      if (amount <= 0) return jsonResp(400, { error: '投注金额必须大于0' });

      const matchResult = await db.collection('matches').doc(matchId).get();
      const match = matchResult.data;
      if (!match) return jsonResp(404, { error: '比赛不存在' });
      if (match.status !== 'upcoming') return jsonResp(400, { error: '比赛已开始或已结束，无法投注' });

      const userResult = await db.collection('users').doc(userId).get();
      const user = userResult.data;
      if (user.points < amount) return jsonResp(400, { error: '积分不足' });

      const existingBet = await db.collection('bets').where({ 
        user_id: userId, 
        match_id: matchId 
      }).limit(1).get();
      
      if (existingBet.data.length > 0) return jsonResp(400, { error: '您已经对本场比赛下过注了' });

      await db.collection('users').doc(userId).update({
        points: _.inc(-amount)
      });
      
      await db.collection('bets').add({
        user_id: userId,
        match_id: matchId,
        bet_team: betTeam,
        amount: amount,
        status: 'pending',
        payout: 0,
        created_at: new Date()
      });

      const updatedUser = await db.collection('users').doc(userId).get();
      return jsonResp(200, { message: '投注成功', remainingPoints: updatedUser.data.points });
    }
    
    if (path === '/api/my-bets' && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const betsResult = await db.collection('bets').where({ 
        user_id: userId 
      }).orderBy('created_at', 'desc').limit(100).get();
      
      const bets = [];
      for (const bet of betsResult.data) {
        const matchResult = await db.collection('matches').doc(bet.match_id).get();
        const match = matchResult.data;
        bets.push({
          ...bet,
          id: bet._id,
          team1: match.team1,
          team2: match.team2,
          match_status: match.status,
          match_time: match.match_time,
          tournament_name: match.tournament_name
        });
      }
      
      return jsonResp(200, bets);
    }
    
    // ==================== TOURNAMENTS ====================
    
    if (path === '/api/tournaments' && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const tournamentsResult = await db.collection('tournaments').orderBy('created_at', 'desc').limit(100).get();
      const tournaments = [];
      
      for (const t of tournamentsResult.data) {
        const teamsResult = await db.collection('tournament_teams').where({ 
          tournament_id: t._id 
        }).get();
        
        tournaments.push({
          ...t,
          id: t._id,
          teams: teamsResult.data.map(team => ({ ...team, id: team._id }))
        });
      }
      
      return jsonResp(200, tournaments);
    }
    
    if (path.startsWith('/api/tournaments/') && !path.startsWith('/api/admin/') && path.split('/').length === 4 && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const tournamentId = path.split('/')[3];
      const tournamentResult = await db.collection('tournaments').doc(tournamentId).get();
      if (!tournamentResult.data) return jsonResp(404, { error: '锦标赛不存在' });
      
      const tournament = tournamentResult.data;
      const teamsResult = await db.collection('tournament_teams').where({ 
        tournament_id: tournamentId 
      }).get();
      
      return jsonResp(200, {
        ...tournament,
        id: tournament._id,
        teams: teamsResult.data.map(team => ({ ...team, id: team._id }))
      });
    }
    
    if (path === '/api/predict' && method === 'POST') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const { tournamentId, predictionType, teamId, betAmount } = body;
      if (!tournamentId || !predictionType || !teamId || !betAmount) return jsonResp(400, { error: '参数不完整' });
      if (!MULTIPLIERS[predictionType]) return jsonResp(400, { error: '无效的预测类型' });
      if (betAmount <= 0) return jsonResp(400, { error: '投注金额必须大于0' });

      const tournamentResult = await db.collection('tournaments').doc(tournamentId).get();
      const tournament = tournamentResult.data;
      if (!tournament) return jsonResp(404, { error: '锦标赛不存在' });
      if (tournament.status !== 'upcoming') return jsonResp(400, { error: '该锦标赛已截止预测' });

      const teamResult = await db.collection('tournament_teams').where({ 
        _id: teamId, 
        tournament_id: tournamentId 
      }).limit(1).get();
      
      if (teamResult.data.length === 0) return jsonResp(404, { error: '队伍不存在' });

      const userResult = await db.collection('users').doc(userId).get();
      const user = userResult.data;
      if (user.points < betAmount) return jsonResp(400, { error: '积分不足' });

      const existing = await db.collection('tournament_predictions').where({ 
        user_id: userId, 
        tournament_id: tournamentId, 
        prediction_type: predictionType 
      }).limit(1).get();
      
      if (existing.data.length > 0) return jsonResp(400, { error: '您已经做过此类型的预测了' });

      await db.collection('users').doc(userId).update({
        points: _.inc(-betAmount)
      });
      
      await db.collection('tournament_predictions').add({
        user_id: userId,
        tournament_id: tournamentId,
        prediction_type: predictionType,
        team_id: teamId,
        bet_amount: betAmount,
        status: 'pending',
        payout: 0,
        created_at: new Date()
      });

      const updatedUser = await db.collection('users').doc(userId).get();
      return jsonResp(200, { message: '预测成功', multiplier: MULTIPLIERS[predictionType], remainingPoints: updatedUser.data.points });
    }
    
    if (path === '/api/my-predictions' && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const predsResult = await db.collection('tournament_predictions').where({ 
        user_id: userId 
      }).orderBy('created_at', 'desc').limit(100).get();
      
      const predictions = [];
      for (const pred of predsResult.data) {
        const tournamentResult = await db.collection('tournaments').doc(pred.tournament_id).get();
        const tournament = tournamentResult.data;
        
        const teamResult = await db.collection('tournament_teams').doc(pred.team_id).get();
        const team = teamResult.data;
        
        predictions.push({
          ...pred,
          id: pred._id,
          tournament_name: tournament.name,
          tournament_status: tournament.status,
          team_name: team.team_name
        });
      }
      
      return jsonResp(200, predictions);
    }
    
    if (path === '/api/leaderboard' && method === 'GET') {
      const userId = await verifyAuth(event);
      if (!userId) return jsonResp(401, { error: '请先登录' });
      
      const usersResult = await db.collection('users').where({ 
        is_admin: 0 
      }).orderBy('points', 'desc').limit(100).get();
      
      const users = usersResult.data.map(u => ({
        id: u._id,
        username: u.username,
        points: u.points,
        created_at: u.created_at
      }));
      
      return jsonResp(200, users);
    }
    
    // ==================== ADMIN ====================
    
    if (path === '/api/admin/users' && method === 'GET') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const usersResult = await db.collection('users').orderBy('points', 'desc').limit(1000).get();
      const users = usersResult.data.map(u => ({
        id: u._id,
        username: u.username,
        points: u.points,
        is_admin: u.is_admin,
        created_at: u.created_at
      }));
      
      return jsonResp(200, users);
    }
    
    if (path.startsWith('/api/admin/users/') && path.endsWith('/points') && method === 'POST') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const userId = path.split('/')[4];
      const { points } = body;
      if (points === undefined || points < 0) return jsonResp(400, { error: '无效的积分数' });
      
      await db.collection('users').doc(userId).update({ points });
      return jsonResp(200, { message: '积分已更新' });
    }
    
    if (path === '/api/admin/matches' && method === 'POST') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const { team1, team2, matchTime, tournamentName } = body;
      if (!team1 || !team2) return jsonResp(400, { error: '队伍名称不能为空' });
      
      const result = await db.collection('matches').add({
        team1,
        team2,
        match_time: matchTime || null,
        status: 'upcoming',
        winner: null,
        tournament_name: tournamentName || '',
        created_at: new Date()
      });
      
      return jsonResp(200, { message: '比赛已创建', matchId: result.id });
    }
    
    if (path.startsWith('/api/admin/matches/') && method === 'DELETE') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const parts = path.split('/');
      const matchId = parts[4];
      
      const matchResult = await db.collection('matches').doc(matchId).get();
      const match = matchResult.data;
      
      if (!match) return jsonResp(404, { error: '比赛不存在' });
      
      if (match.status === 'betting' || match.status === 'finished') {
        const betsResult = await db.collection('bets').where({ match_id: matchId }).get();
        
        for (const bet of betsResult.data) {
          if (bet.status === 'pending') {
            await db.collection('users').doc(bet.user_id).update({
              points: _.inc(bet.amount)
            });
          }
        }
        
        await db.collection('bets').where({ match_id: matchId }).remove();
      }
      
      await db.collection('matches').doc(matchId).remove();
      return jsonResp(200, { message: '比赛已删除' });
    }
    
    if (path.startsWith('/api/admin/matches/') && path.endsWith('/start') && method === 'POST') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const matchId = path.split('/')[4];
      const matchResult = await db.collection('matches').doc(matchId).get();
      const match = matchResult.data;
      
      if (!match) return jsonResp(404, { error: '比赛不存在' });
      if (match.status !== 'upcoming') return jsonResp(400, { error: '只有待开始的比赛可以开赛' });
      
      await db.collection('matches').doc(matchId).update({ status: 'betting' });
      return jsonResp(200, { message: '比赛已开始，投注已截止' });
    }
    
    if (path.startsWith('/api/admin/matches/') && path.endsWith('/resolve') && method === 'POST') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const matchId = path.split('/')[4];
      const { winner } = body;
      if (winner !== 1 && winner !== 2) return jsonResp(400, { error: '请选择获胜队伍' });

      const matchResult = await db.collection('matches').doc(matchId).get();
      const match = matchResult.data;
      
      if (!match) return jsonResp(404, { error: '比赛不存在' });
      if (match.status !== 'betting') return jsonResp(400, { error: '只有进行中的比赛可以结算' });

      const betsResult = await db.collection('bets').where({ match_id: matchId }).get();
      const bets = betsResult.data;
      
      const totalPool = bets.reduce((sum, b) => sum + b.amount, 0);
      const winnerBets = bets.filter(b => b.bet_team === winner);
      const winnerTotal = winnerBets.reduce((sum, b) => sum + b.amount, 0);

      for (const bet of bets) {
        if (bet.bet_team === winner) {
          const payout = winnerTotal > 0 ? Math.floor((bet.amount / winnerTotal) * totalPool) : 0;
          await db.collection('bets').doc(bet._id).update({ status: 'won', payout });
          if (payout > 0) {
            await db.collection('users').doc(bet.user_id).update({
              points: _.inc(payout)
            });
          }
        } else {
          await db.collection('bets').doc(bet._id).update({ status: 'lost', payout: 0 });
        }
      }
      
      await db.collection('matches').doc(matchId).update({ status: 'finished', winner });

      const winnerTeam = winner === 1 ? match.team1 : match.team2;
      return jsonResp(200, { message: `比赛已结算，${winnerTeam} 获胜`, totalPool, winnerCount: winnerBets.length });
    }
    
    if (path === '/api/admin/tournaments' && method === 'POST') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const { name, teams } = body;
      if (!name) return jsonResp(400, { error: '锦标赛名称不能为空' });
      if (!teams || teams.length < 2) return jsonResp(400, { error: '至少需要2支队伍' });

      const tournamentResult = await db.collection('tournaments').add({
        name,
        status: 'upcoming',
        created_at: new Date()
      });
      
      const tid = tournamentResult.id;
      
      for (const teamName of teams) {
        await db.collection('tournament_teams').add({
          tournament_id: tid,
          team_name: teamName.trim(),
          eliminated: 0
        });
      }
      
      return jsonResp(200, { message: '锦标赛已创建', tournamentId: tid });
    }
    
    if (path.startsWith('/api/admin/tournaments/') && path.endsWith('/close') && method === 'POST') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const tournamentId = path.split('/')[4];
      await db.collection('tournaments').doc(tournamentId).update({ status: 'closed' });
      return jsonResp(200, { message: '锦标赛预测已截止' });
    }
    
    if (path.startsWith('/api/admin/tournaments/') && path.endsWith('/resolve') && method === 'POST') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const tournamentId = path.split('/')[4];
      const { champion, runnerUp, thirdPlace, top4, top8, qualify } = body;
      
      const tournamentResult = await db.collection('tournaments').doc(tournamentId).get();
      const tournament = tournamentResult.data;
      
      if (!tournament) return jsonResp(404, { error: '锦标赛不存在' });

      const results = { champion, runner_up: runnerUp, third_place: thirdPlace, top4, top8, qualify };

      for (const [type, teamIds] of Object.entries(results)) {
        if (!teamIds || !MULTIPLIERS[type]) continue;
        const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
        
        for (const teamId of ids) {
          const predictionsResult = await db.collection('tournament_predictions').where({ 
            tournament_id: tournamentId, 
            prediction_type: type, 
            team_id: teamId 
          }).get();
          
          for (const pred of predictionsResult.data) {
            const payout = pred.bet_amount * MULTIPLIERS[type];
            await db.collection('tournament_predictions').doc(pred._id).update({ status: 'won', payout });
            await db.collection('users').doc(pred.user_id).update({
              points: _.inc(payout)
            });
          }
          
          const pendingPredsResult = await db.collection('tournament_predictions').where({ 
            tournament_id: tournamentId, 
            prediction_type: type, 
            status: 'pending' 
          }).get();
          
          for (const pred of pendingPredsResult.data) {
            await db.collection('tournament_predictions').doc(pred._id).update({ status: 'lost', payout: 0 });
          }
        }
      }
      
      await db.collection('tournaments').doc(tournamentId).update({ status: 'finished' });
      return jsonResp(200, { message: '锦标赛已结算' });
    }
    
    if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
      const adminId = await verifyAdmin(event);
      if (!adminId) return jsonResp(403, { error: '需要管理员权限' });
      
      const userId = path.split('/')[4];
      const userResult = await db.collection('users').doc(userId).get();
      const user = userResult.data;
      
      if (!user) return jsonResp(404, { error: '用户不存在' });
      if (user.is_admin) return jsonResp(400, { error: '不能删除管理员' });
      
      await db.collection('bets').where({ user_id: userId }).remove();
      await db.collection('tournament_predictions').where({ user_id: userId }).remove();
      await db.collection('users').doc(userId).remove();
      
      return jsonResp(200, { message: '用户已删除' });
    }
    
    return jsonResp(404, { error: 'Not found' });
    
  } catch (err) {
    console.error(err);
    return jsonResp(500, { error: err.message });
  }
};
