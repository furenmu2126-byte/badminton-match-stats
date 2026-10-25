(function (root) {
  const techniques = ['杀球', '高远球', '吊球', '网前球', '平抽挡', '接杀', '发球 / 接发', '其他'];
  const reasons = { win: ['直接得分', '迫使对方失误', '对方主动失误', '相持得分', '其他'], lose: ['下网', '出界', '回球不到位', '被对方进攻击穿', '步法 / 回位不到位', '判断失误', '相持失误', '其他'] };
  const areas = ['左前', '中前', '右前', '左中', '中场', '右中', '左后', '中后', '右后'];
  const DEFAULT_RULES = { mode: 'official', targetScore: 21, gamesToWin: 2 };
  function normalizeRules(input) {
    const mode = input?.mode === 'free' ? 'free' : 'official';
    const targetScore = Number(input?.targetScore);
    const allowed = mode === 'free' ? [5, 7, 11, 15, 21] : [15, 21];
    return { mode, targetScore: allowed.includes(targetScore) ? targetScore : mode === 'free' ? 5 : 21, gamesToWin: mode === 'free' ? 1 : 2 };
  }
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function createMatch(playerName, opponentName, rules = DEFAULT_RULES) {
    const clean = value => String(value ?? '').trim();
    return { matchId: uid(), playerName: clean(playerName) || '我方', opponentName: clean(opponentName) || '对手', rules: normalizeRules(rules), createdAt: new Date().toISOString(), games: [], events: [] };
  }
  function state(events, matchRules = DEFAULT_RULES) {
    const rules = normalizeRules(matchRules);
    const games = [];
    let us = 0, opponent = 0, won = 0, lost = 0, rally = 0;
    for (const event of events) {
      if (won === rules.gamesToWin || lost === rules.gamesToWin) throw new Error('比赛已结束');
      if (event.result !== 'win' && event.result !== 'lose') throw new Error('无效的得失分');
      us += Number(event.result === 'win'); opponent += Number(event.result === 'lose'); rally++;
      const high = Math.max(us, opponent), lead = Math.abs(us - opponent);
      const gameOver = rules.mode === 'free'
        ? high >= rules.targetScore
        : high >= (rules.targetScore === 15 ? 21 : 30) || (high >= rules.targetScore && lead >= 2);
      if (gameOver) {
        const winner = us > opponent ? 'win' : 'lose';
        games.push({ gameNumber: games.length + 1, scoreUs: us, scoreOpponent: opponent, winner });
        winner === 'win' ? won++ : lost++;
        us = 0; opponent = 0; rally = 0;
      }
    }
    return { games, us, opponent, won, lost, rally, gameNumber: Math.min(games.length + 1, rules.gamesToWin === 2 ? 3 : 1), finished: won === rules.gamesToWin || lost === rules.gamesToWin };
  }
  function add(match, result, technique, reason) {
    const rules = normalizeRules(match.rules);
    const current = state(match.events, rules);
    if (current.finished) throw new Error('比赛已结束');
    if (!techniques.includes(technique) || !reasons[result]?.includes(reason)) throw new Error('无效的技术或原因');
    const event = { id: uid(), gameNumber: current.gameNumber, rallyNumber: current.rally + 1, result, technique, opponentTechnique: null, reason, area: null, scoreUs: current.us + Number(result === 'win'), scoreOpponent: current.opponent + Number(result === 'lose'), timestamp: new Date().toISOString() };
    const events = [...match.events, event];
    return { ...match, rules, events, games: state(events, rules).games };
  }
  function undo(match) {
    const events = match.events.slice(0, -1);
    const rules = normalizeRules(match.rules);
    return { ...match, rules, events, games: state(events, rules).games };
  }
  function setArea(match, eventId, area) {
    if (!areas.includes(area) || !match.events.some(event => event.id === eventId)) throw new Error('无效区域');
    return { ...match, events: match.events.map(event => event.id === eventId ? { ...event, area, areaSkipped: false } : event) };
  }
  function setOpponentTechnique(match, eventId, technique) {
    if (!techniques.includes(technique) || !match.events.some(event => event.id === eventId)) throw new Error('无效的对手技术或逐分编号');
    return { ...match, events: match.events.map(event => event.id === eventId ? { ...event, opponentTechnique: technique } : event) };
  }
  function stats(match) {
    const count = (list, field, result) => list.map(label => ({ label, count: match.events.filter(event => event.result === result && event[field] === label).length }));
    const wins = match.events.filter(event => event.result === 'win').length;
    const losses = match.events.filter(event => event.result === 'lose').length;
    const winTech = count(techniques, 'technique', 'win'), loseTech = count(techniques, 'technique', 'lose'), loseReasons = count(reasons.lose, 'reason', 'lose');
    const recorded = match.events.filter(event => areas.includes(event.area));
    const region = (label, indices) => ({ label, win: recorded.filter(event => event.result === 'win' && indices.includes(areas.indexOf(event.area))).length, lose: recorded.filter(event => event.result === 'lose' && indices.includes(areas.indexOf(event.area))).length });
    const regions = [region('前场', [0,1,2]), region('中场', [3,4,5]), region('后场', [6,7,8]), region('左侧', [0,3,6]), region('中路', [1,4,7]), region('右侧', [2,5,8])];
    const top = rows => rows.filter(row => row.count).slice().sort((a,b) => b.count-a.count).slice(0,2).map(row => row.label).join('和');
    const summary = [wins ? `本场得分记录主要集中在${top(winTech)}。` : '', losses ? `本场主要失分原因是${top(loseReasons)}。` : ''].filter(Boolean).join('');
    const court = regions.slice(0,3).filter(row => row.win || row.lose).sort((a,b) => b.lose-a.lose).slice(0,2);
    const areaSummary = recorded.length ? court.map(row => `${row.label}得分 ${row.win} 次、失分 ${row.lose} 次`).join('；') : '';
    return { wins, losses, winTech, loseTech, loseReasons, regions, recorded: recorded.length, summary, areaSummary };
  }
  const api = { techniques, reasons, areas, DEFAULT_RULES, normalizeRules, createMatch, state, add, undo, setArea, setOpponentTechnique, stats };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Badminton = api;
})(globalThis);

