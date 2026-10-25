const assert = require('node:assert/strict');
const { test } = require('node:test');
const core = require('./core.js');
test('失分前置原因按观察顺序关联原回合，且不改变比分', () => {
  const original = core.add(core.createMatch('甲', '乙'), 'lose', '接杀', '被对方进攻击穿');
  const id = original.events[0].id;
  const causes = ['被调动失位', '被动回球过浅'];
  const updated = core.setLossCauses(original, id, causes);
  causes.reverse();
  assert.deepEqual(updated.events[0].lossCauses, ['被调动失位', '被动回球过浅']);
  assert.equal(original.events[0].lossCauses, null);
  assert.equal(core.lossChain(updated.events[0]), '被调动失位 → 被动回球过浅 → 被对方进攻击穿');
  assert.deepEqual(core.state(updated.events), core.state(original.events));
  assert.equal(updated.events.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(updated)), updated);
  const report = core.stats(updated);
  assert.equal(report.lossCausesRecorded, 1);
  assert.deepEqual(report.lossCauseCounts.map(row => row.count), [1, 1]);
  assert.equal(report.loseReasons.find(row => row.label === '被对方进攻击穿').count, 1);
  const cleared = core.setLossCauses(updated, id, null);
  assert.equal(core.stats(cleared).lossCausesRecorded, 0);
  assert.equal(core.stats(core.undo(updated)).lossCauseCounts.every(row => !row.count), true);
});
test('旧回合缺失前置原因保持未知，非法原因和得分回合不能补记', () => {
  const match = core.add(core.createMatch('甲', '乙'), 'lose', '接杀', '被对方进攻击穿');
  delete match.events[0].lossCauses;
  const id = match.events[0].id;
  assert.equal(core.validLossCauses(match.events[0]), true);
  assert.equal(core.stats(match).lossCausesRecorded, 0);
  assert.equal(core.stats(match).lossCauseCounts.every(row => row.count === 0), true);
  for (const invalid of [[], ['未知原因'], ['被调动失位', '被调动失位'], '被调动失位']) {
    assert.throws(() => core.setLossCauses(match, id, invalid));
    assert.equal(core.validLossCauses({ result: 'lose', lossCauses: invalid }), false);
  }
  assert.throws(() => core.setLossCauses(match, 'missing', ['被调动失位']));
  const won = core.add(match, 'win', '杀球', '直接得分');
  assert.throws(() => core.setLossCauses(won, won.events.at(-1).id, ['被调动失位']));
  const reversed = core.setLossCauses(match, id, ['被动回球过浅', '被调动失位']);
  assert.equal(core.lossChain(reversed.events[0]), '被动回球过浅 → 被调动失位 → 被对方进攻击穿');
});
function point(match, result = 'win') { return core.add(match, result, '杀球', result === 'win' ? '直接得分' : '出界'); }
function score(us, opponent, rules) {
  let match = core.createMatch('小明', '对手', rules);
  for (let index = 0; index < Math.min(us, opponent); index++) { match = point(point(match), 'lose'); }
  for (let index = 0; index < Math.abs(us - opponent); index++) match = point(match, us > opponent ? 'win' : 'lose');
  return match;
}
test('21:19、21:20、22:20 与 30:29 的边界', () => {
  assert.equal(core.state(score(21, 19).events).games.length, 1);
  assert.equal(core.state(score(21, 20).events).games.length, 0);
  assert.equal(core.state(score(22, 20).events).games.length, 1);
  assert.equal(core.state(score(29, 29).events).games.length, 0);
  assert.deepEqual(core.state(score(30, 29).events).games[0], { gameNumber: 1, scoreUs: 30, scoreOpponent: 29, winner: 'win' });
});
test('两局结束、末分撤销和跨局撤销', () => {
  let match = score(21, 0);
  assert.equal(core.state(core.undo(match).events).us, 20);
  match = point(match, 'lose');
  assert.equal(match.events.at(-1).gameNumber, 2);
  assert.equal(match.events.at(-1).rallyNumber, 1);
  match = core.undo(match);
  for (let index = 0; index < 21; index++) match = point(match);
  assert.equal(core.state(match.events).finished, true);
  assert.throws(() => point(match));
  match = core.undo(match);
  assert.equal(core.state(match.events).finished, false);
  assert.equal(core.state(match.events).us, 20);
});
test('三局两胜与对方获胜', () => {
  let match = score(0, 21);
  for (let index = 0; index < 21; index++) match = point(match);
  for (let index = 0; index < 21; index++) match = point(match, 'lose');
  assert.equal(core.state(match.events).lost, 2);
  assert.equal(match.games.length, 3);
});
test('区域、统计、撤销和序列化恢复', () => {
  let match = point(core.createMatch('小明', '对手'));
  match = core.setArea(match, match.events.at(-1).id, '左后');
  match = point(match, 'lose');
  const report = core.stats(match);
  assert.equal(report.wins, 1); assert.equal(report.losses, 1);
  assert.equal(report.recorded, 1); assert.equal(report.regions[2].win, 1);
  assert.equal(report.regions[3].win, 1);
  assert.equal(report.loseReasons.find(row => row.label === '出界').count, 1);
  assert.equal(core.stats(core.undo(match)).losses, 0);
  assert.deepEqual(core.state(JSON.parse(JSON.stringify(match)).events), core.state(match.events));
  assert.equal(core.stats(core.createMatch('', '')).summary, '');
});
test('默认名称、覆盖空局比分与稳定的比例统计', () => {
  const match = core.createMatch('  ', ' 对手 ');
  assert.equal(match.playerName, '我方'); assert.equal(match.opponentName, '对手');
  const report = core.stats(match);
  assert.equal(report.wins, 0); assert.equal(report.losses, 0);
  assert.equal(report.winTech.every(row => row.count === 0), true);
  assert.equal(report.recorded, 0); assert.equal(report.areaSummary, '');
});
test('补填区域使用明确事件 ID，且不增加逐分事件', () => {
  let match = point(core.createMatch('小明', '对手'));
  const id = match.events[0].id;
  match = point(match, 'lose');
  match = core.setArea(match, id, '左后');
  assert.equal(match.events.length, 2);
  assert.equal(match.events[0].area, '左后');
  assert.equal(match.events[1].area, null);
  assert.throws(() => core.setArea(match, 'missing-id', '左后'));
});
test('可选补记对手关键技术，绑定原逐分且不改变比分', () => {
  let match = point(core.createMatch('甲', '乙'));
  const id = match.events[0].id;
  match = point(match, 'lose');
  match = core.setOpponentTechnique(match, id, '杀球');
  assert.equal(match.events.length, 2);
  assert.equal(match.events[0].opponentTechnique, '杀球');
  assert.equal(match.events[1].opponentTechnique, null);
  assert.equal(core.state(match.events, match.rules).us, 1);
  assert.throws(() => core.setOpponentTechnique(match, 'missing-id', '杀球'));
});
test('正规 15 分制：14 平加分，21 分封顶', () => {
  assert.equal(core.state(score(15, 13, { mode: 'official', targetScore: 15 }).events, { mode: 'official', targetScore: 15 }).games.length, 1);
  assert.equal(core.state(score(15, 14, { mode: 'official', targetScore: 15 }).events, { mode: 'official', targetScore: 15 }).games.length, 0);
  assert.equal(core.state(score(16, 14, { mode: 'official', targetScore: 15 }).events, { mode: 'official', targetScore: 15 }).games.length, 1);
  assert.equal(core.state(score(20, 20, { mode: 'official', targetScore: 15 }).events, { mode: 'official', targetScore: 15 }).games.length, 0);
  assert.equal(core.state(score(21, 20, { mode: 'official', targetScore: 15 }).events, { mode: 'official', targetScore: 15 }).games.length, 1);
});
test('自由赛可选五种目标分，单局到分即胜且撤销可继续', () => {
  for (const targetScore of [5, 7, 11, 15, 21]) {
    const rules = { mode: 'free', targetScore };
    let match = score(targetScore, targetScore - 1, rules);
    let result = core.state(match.events, match.rules);
    assert.equal(result.finished, true);
    assert.equal(result.games.length, 1);
    assert.equal(result.won, 1);
    match = core.undo(match);
    result = core.state(match.events, match.rules);
    assert.equal(result.finished, false);
    assert.equal(result.us, targetScore - 1);
  }
});
test('自由赛第一分就到目标且不自动进入第二局', () => {
  let match = core.createMatch('甲', '乙', { mode: 'free', targetScore: 5 });
  for (let i = 0; i < 5; i++) match = point(match);
  const result = core.state(match.events, match.rules);
  assert.equal(result.finished, true);
  assert.equal(result.gameNumber, 1);
  assert.equal(match.events.at(-1).gameNumber, 1);
  assert.throws(() => point(match));
});
