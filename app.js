(() => {
  const core = window.Badminton, STORE_KEY = 'badminton-v02-sessions', OLD_KEY = 'badminton-v01-match';
  const $ = id => document.getElementById(id);
  const screens = { home: $('home'), record: $('record'), report: $('report'), session: $('session-report') };
  let sessions = [], session = null, match = null, pendingAreaId = null, busy = false;
  let selection = { result: null, technique: null }, selectedRules = { mode: 'official', targetScore: 21 };
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const fmt = rule => `${rule.mode === 'free' ? '自由比赛 · 一局定胜负' : '正规比赛 · 三局两胜'} · ${rule.targetScore} 分`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stateOf = item => core.state(item.events, item.rules);

  function announce(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = !message; }
  function showScreen(name) { for (const [key, screen] of Object.entries(screens)) screen.hidden = key !== name; window.scrollTo({top:0, behavior:'auto'}); }
  function setMode(mode) {
    selectedRules = { mode, targetScore: mode === 'free' ? 5 : 21 };
    document.querySelectorAll('[data-mode]').forEach(button => { const on = button.dataset.mode === mode; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on)); });
    $('official-scores').hidden = mode !== 'official'; $('free-scores').hidden = mode !== 'free';
    $('mode-description').textContent = mode === 'official' ? '三局两胜。21 分制在 20 平后需领先 2 分、30 分封顶；15 分制在 14 平后需领先 2 分、21 分封顶。' : '一局定胜负，先到目标分获胜，不加分。';
    syncTargets();
  }
  function syncTargets() {
    document.querySelectorAll('#official-scores [data-target],.free-score-button').forEach(button => { const on = Number(button.dataset.target) === selectedRules.targetScore; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on)); });
    if (selectedRules.mode === 'free') $('free-description').textContent = `一局定胜负，先到 ${selectedRules.targetScore} 分获胜，不加分。`;
  }
  function setTarget(value) { selectedRules.targetScore = Number(value); syncTargets(); }
  function persist(next) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); }
    catch (error) { announce(`保存失败：${error?.name === 'QuotaExceededError' ? '浏览器存储空间不足' : '浏览器不允许保存数据'}。本次更改未完成，请导出或检查浏览器设置后重试。`, true); return false; }
    sessions = next; return true;
  }
  function validateMatch(value) {
    if (!value || typeof value.matchId !== 'string' || typeof value.playerName !== 'string' || typeof value.opponentName !== 'string' || !Array.isArray(value.events)) throw new Error('比赛记录结构不完整');
    for (const e of value.events) if (!e || typeof e.id !== 'string' || !['win','lose'].includes(e.result) || !core.techniques.includes(e.technique) || (e.opponentTechnique != null && !core.techniques.includes(e.opponentTechnique)) || !core.validLossCauses(e) || !core.reasons[e.result]?.includes(e.reason) || (e.area !== null && !core.areas.includes(e.area))) throw new Error('比赛记录含无法识别的逐分数据');
    const rules = core.normalizeRules(value.rules);
    return { ...value, rules, games: core.state(value.events, rules).games };
  }
  function validateSession(value) {
    if (!value || typeof value.sessionId !== 'string' || typeof value.date !== 'string' || typeof value.playerName !== 'string' || !Array.isArray(value.matches) || !value.matches.length) throw new Error('训练场次结构不完整');
    const matches = value.matches.map(validateMatch);
    return { ...value, matches, status: value.status === 'completed' ? 'completed' : 'active', currentMatchId: value.currentMatchId || matches.at(-1).matchId };
  }
  function readSessions() {
    let raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch { throw new Error('无法读取本机训练记录，请检查浏览器存储设置。'); }
    if (raw !== null) {
      try { const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) throw Error(); return parsed.map(validateSession); }
      catch { throw new Error('本机训练记录无法读取，原数据已保留。'); }
    }
    let old;
    try { old = localStorage.getItem(OLD_KEY); } catch { throw new Error('无法读取原比赛记录，原数据已保留。'); }
    if (!old) return [];
    try {
      const game = validateMatch(JSON.parse(old)), done = stateOf(game).finished, date = String(game.createdAt || new Date().toISOString()).slice(0,10);
      const migrated = [{sessionId:`migrated-${game.matchId}`,date,title:`${date} · 已有比赛`,playerName:game.playerName,createdAt:game.createdAt || new Date().toISOString(),updatedAt:new Date().toISOString(),status:done?'completed':'active',currentMatchId:game.matchId,matches:[game]}];
      try { localStorage.setItem(STORE_KEY, JSON.stringify(migrated)); } catch { throw new Error('新存储空间不足，旧比赛仍保留在原位置。'); }
      return migrated;
    } catch (error) { if (error.message.includes('仍保留')) throw error; throw new Error('原比赛记录无法升级，原数据已保留。'); }
  }
  function saveMatch(candidate) {
    if (!session) return false;
    const updated = {...session,updatedAt:new Date().toISOString(),matches:session.matches.map(item=>item.matchId===candidate.matchId?candidate:item)};
    const next = sessions.map(item=>item.sessionId===session.sessionId?updated:item);
    if (!persist(next)) return false;
    session = updated; match = candidate; renderHistory(); return true;
  }
  function saveSession(candidate) {
    const updated = {...candidate,updatedAt:new Date().toISOString()};
    if (!persist(sessions.map(item=>item.sessionId===updated.sessionId?updated:item))) return false;
    session = updated; renderHistory(); return true;
  }
  function resetSelection() { selection={result:null,technique:null}; $('result-choices').hidden=false; $('choice-panel').hidden=true; $('entry-title').textContent='这一分，谁得分？'; $('entry-step').textContent='01 / 03'; }
  function commit(candidate) { if (!saveMatch(candidate)) return false; pendingAreaId=null; resetSelection(); announce(''); render(); return true; }

  function renderHistory() {
    $('history-count').textContent = sessions.length ? `${sessions.length} 场训练` : '';
    const ordered=sessions.slice().sort((a,b)=>`${b.date}${b.updatedAt||''}`.localeCompare(`${a.date}${a.updatedAt||''}`));
    $('session-list').innerHTML=ordered.length?ordered.map(s=>{
      const names=[...new Set(s.matches.map(m=>m.opponentName||'对手'))], wins=s.matches.filter(m=>stateOf(m).finished && stateOf(m).won>stateOf(m).lost).length;
      return `<div class="session-row"><span class="session-date">${esc(s.date)}</span><span class="session-row-main"><b>${esc(s.title||'羽毛球练习')}</b><small>${s.matches.length} 场比赛 · ${esc(names.join('、'))} · ${wins} 胜</small></span><span class="session-row-actions"><button type="button" data-session-id="${esc(s.sessionId)}">${s.status==='completed'?'查看场次':'继续记录'}</button><button type="button" data-session-summary-id="${esc(s.sessionId)}">查看汇总</button></span></div>`;
    }).join(''):'<p class="empty-history">完成一场比赛后，记录会保存在这里。</p>';
  }
  function renderScore() {
    const st=stateOf(match); $('match-format').textContent=fmt(match.rules); $('match-caption').textContent=`${match.playerName} · ${match.opponentName}`;
    $('player-label').textContent=match.playerName; $('opponent-label').textContent=match.opponentName; $('score-us').textContent=st.us; $('score-opponent').textContent=st.opponent;
    $('sets-us').textContent=st.won; $('sets-opponent').textContent=st.lost; $('game-label').textContent=`第 ${st.gameNumber} 局`; $('games-score').textContent=`${st.won} : ${st.lost}`;
    $('rally-count').textContent=`已记录 ${match.events.length} 分`; $('undo-button').disabled=!match.events.length; $('undo-button').style.opacity=match.events.length? '1':'.5';
    $('area-panel').hidden=!pendingAreaId; renderAreaGrid(document.querySelector('#area-panel .court-grid'),area=>fillArea(pendingAreaId,area));
    const last=match.events.find(event=>event.id===pendingAreaId);
    renderLossCauseChoices($('loss-cause-entry'),last);
    renderOpponentTechChoices($('opponent-tech-choices'),last,technique=>saveOpponentTechnique(pendingAreaId,technique));
  }
  function renderAreaGrid(node, callback) { if(node)node.replaceChildren(...core.areas.map(area=>{const b=document.createElement('button');b.type='button';b.className='court-cell';b.textContent=area;b.addEventListener('click',()=>callback(area));return b;})); }
  function renderOpponentTechChoices(node, event, callback) {
    if (!node) return;
    node.replaceChildren(...core.techniques.map(technique=>{const b=document.createElement('button');b.type='button';b.className='choice-button';b.textContent=technique;if(event?.opponentTechnique===technique)b.classList.add('selected');b.addEventListener('click',()=>callback(technique));return b;}));
  }
  function saveOpponentTechnique(eventId, technique, inReport=false) {
    if(!eventId||busy)return;
    const candidate=core.setOpponentTechnique(match,eventId,technique),event=candidate.events.find(item=>item.id===eventId);
    if(!inReport)candidate.waitingAreaEventId=event.area||event.areaSkipped?null:eventId;
    if(!saveMatch(candidate))return;
    match=candidate;announce(`已记录对手本分关键技术：${technique}`);
    if(inReport)renderReport();else renderScore();
  }
  function renderLossCauseChoices(node, event, inReport=false) {
    if (!node) return;
    node.replaceChildren();
    if (event?.result !== 'lose') return;
    const heading=document.createElement('h3');heading.textContent='失分前置原因（可选、多选）';
    const help=document.createElement('p');help.className='metric-caption';help.textContent='按实际发生先后点击；再次点击可取消。只补记观察到的原因。';
    const choices=document.createElement('div');choices.className='choice-grid';
    const selected=event.lossCauses||[];
    for(const cause of core.lossCauses){
      const b=document.createElement('button'),index=selected.indexOf(cause);
      b.type='button';b.className='choice-button';b.classList.toggle('selected',index>=0);b.setAttribute('aria-pressed',String(index>=0));b.textContent=index>=0?`${index+1}. ${cause}`:cause;
      b.addEventListener('click',()=>{
        if(busy)return;
        const current=match.events.find(e=>e.id===event.id),causes=current.lossCauses||[];
        const nextCauses=causes.includes(cause)?causes.filter(value=>value!==cause):[...causes,cause];
        const candidate=core.setLossCauses(match,event.id,nextCauses.length?nextCauses:null);
        if(!saveMatch(candidate))return;
        announce('已保存该回合的前置原因');
        if(inReport)renderReport();else renderLossCauseChoices(node,match.events.find(e=>e.id===event.id));
      });choices.append(b);
    }
    const chain=document.createElement('p');chain.className='metric-caption';chain.textContent=selected.length?`已观察链条：${core.lossChain(event)}`:'前置原因未记录，不据此推断不存在。';
    node.append(heading,help,choices,chain);
  }
  function metricRows(node, rows, denominator, type) {
    const max=Math.max(1,...rows.map(row=>row.count)); node.className=`metric-list ${type==='lose'?'lose-list':''}`;
    node.replaceChildren(...rows.map(row=>{const line=document.createElement('div');line.className='metric-row';const label=document.createElement('span');label.className='metric-name';label.textContent=row.label;const amount=document.createElement('span');amount.className='metric-value';amount.textContent=row.count;const track=document.createElement('span');track.className='metric-track';const bar=document.createElement('i');bar.style.width=`${row.count/max*100}%`;track.append(bar);const ratio=document.createElement('span');ratio.className='metric-ratio';ratio.textContent=denominator?`${(row.count/denominator*100).toFixed(1)}%`:'0.0%';line.append(label,amount,track,ratio);line.title=`${row.label}：${row.count} 次，占 ${ratio.textContent}`;return line;}));
  }
  function renderReport() {
    const st=stateOf(match), report=core.stats(match);
    $('report-subtitle').textContent=`${session.date}　${match.playerName}　${st.won} : ${st.lost}　${match.opponentName}　·　${fmt(match.rules)}`;
    $('result-stamp').textContent=st.finished?(st.won>st.lost?'我方获胜':'对方获胜'):'比赛进行中';$('result-stamp').classList.toggle('lost',st.finished&&st.won<=st.lost);
    $('summary-text').textContent=report.summary||'本场尚无得分或失分记录。';$('total-wins').textContent=report.wins;$('total-losses').textContent=report.losses;
    $('game-table').innerHTML=`<table class="game-table"><thead><tr><th>局数</th><th>${esc(match.playerName)}</th><th>${esc(match.opponentName)}</th><th>结果</th></tr></thead><tbody>${st.games.length?st.games.map(g=>`<tr><td>第 ${g.gameNumber} 局</td><td>${g.scoreUs}</td><td>${g.scoreOpponent}</td><td>${g.winner==='win'?'我方胜':'对方胜'}</td></tr>`).join(''):'<tr><td colspan="4">尚无已完成的局</td></tr>'}</tbody></table>`;
    metricRows($('win-tech'),report.winTech,report.wins,'win');metricRows($('lose-tech'),report.loseTech,report.losses,'lose');metricRows($('lose-reason'),report.loseReasons,report.losses,'lose');
    metricRows($('loss-cause-stats'),report.lossCauseCounts,report.losses,'lose');
    $('loss-cause-coverage').textContent=`已补记 ${report.lossCausesRecorded} / ${report.losses} 个失分回合；每项占总失分比例，多选之和可能超过 100%。未记录不代表没有。`;
    $('loss-chain-list').replaceChildren(...match.events.filter(e=>e.result==='lose'&&e.lossCauses?.length).map(e=>{const p=document.createElement('p');p.className='metric-caption';p.textContent=`第 ${e.gameNumber} 局第 ${e.rallyNumber} 分：${core.lossChain(e)}`;return p;}));
    const opponentTech=core.techniques.map(label=>({label,count:match.events.filter(event=>event.opponentTechnique===label).length}));
    metricRows($('opponent-tech'),opponentTech,opponentTech.reduce((sum,row)=>sum+row.count,0),'win');
    $('area-report-content').innerHTML=report.recorded?`<p class="area-copy">已记录区域 ${report.recorded} 分 / 全场 ${match.events.length} 分</p><div class="region-heading"><span>区域</span><span>得分</span><span>失分</span></div>${report.regions.map(r=>`<div class="region-line"><span>${r.label}</span><span>${r.win}</span><span>${r.lose}</span></div>`).join('')}`:'<p class="area-copy">本场未记录区域</p>';
    const last=match.events.at(-1), final=$('final-area');
    final.hidden=!st.finished||!last||((!!last.area||!!last.areaSkipped)&&!!last.opponentTechnique&&last.result!=='lose');
    if(!final.hidden){const showArea=!last.area&&!last.areaSkipped;final.innerHTML=`<h2>补记最后一分的资料</h2><p class="final-event-label">${last.result==='win'?'我方得分':'我方失分'} · ${esc(last.technique)}</p>${showArea?'<div class="court-grid"></div><button id="final-skip" class="button quiet" type="button">跳过区域</button>':''}<div id="final-loss-causes"></div><details id="final-opponent-details" class="opponent-tech-details" ${last.opponentTechnique?'':'open'}><summary>记录对手本分的关键技术（可选）${last.opponentTechnique?`：${esc(last.opponentTechnique)}`:''}</summary><div id="final-opponent-choices" class="choice-grid"></div></details>`;if(showArea){renderAreaGrid(final.querySelector('.court-grid'),area=>fillArea(last.id,area));$('final-skip').addEventListener('click',()=>{const next={...match,events:match.events.map(e=>e.id===last.id?{...e,areaSkipped:true}:e)};if(saveMatch(next)){match=next;renderReport();}});}renderLossCauseChoices($('final-loss-causes'),last,true);renderOpponentTechChoices($('final-opponent-choices'),last,technique=>saveOpponentTechnique(last.id,technique,true));}
    $('continue-match').hidden=st.finished;$('report-new').disabled=!st.finished;
  }
  function render() { if(!match||!session)return; if(stateOf(match).finished){renderReport();showScreen('report');}else{renderScore();showScreen('record');} }
  function fillArea(id,area){if(!id||busy)return;const next=core.setArea(match,id,area),event=next.events.find(item=>item.id===id);next.waitingAreaEventId=event.opponentTechnique?null:id;if(!saveMatch(next))return;match=next;pendingAreaId=next.waitingAreaEventId;if(stateOf(match).finished)renderReport();else renderScore();announce(`已为该分记录区域：${area}`);}
  function createSession(form) {
    const date=String(form.get('sessionDate')||today()),playerName=String(form.get('playerName')||'').trim()||'我方',title=String(form.get('sessionTitle')||'').trim()||`${date} 羽毛球练习`;
    const first=core.createMatch(playerName,form.get('opponentName'),selectedRules),now=new Date().toISOString();
    const next={sessionId:uid(),date,title,playerName,createdAt:now,updatedAt:now,status:'active',currentMatchId:first.matchId,matches:[first]};
    if(persist([...sessions,next])){session=next;match=first;pendingAreaId=null;resetSelection();announce('');renderHistory();render();}
  }
  function startNext(event) {
    event.preventDefault();if(!session)return;const [mode,target]=$('next-format').value.split(':');
    const nextMatch=core.createMatch(session.playerName,$('next-opponent').value,{mode,targetScore:Number(target)});
    const nextSession={...session,status:'active',currentMatchId:nextMatch.matchId,matches:[...session.matches,nextMatch]};
    if(!persist(sessions.map(s=>s.sessionId===session.sessionId?nextSession:s)))return;
    session=nextSession;match=nextMatch;pendingAreaId=null;resetSelection();$('next-match-dialog').close();announce('');renderHistory();render();
  }
  function sessionStats(s) {
    const map=new Map();let wins=0,pointWins=0,pointLosses=0;
    for(const m of s.matches){const st=stateOf(m),pw=m.events.filter(e=>e.result==='win').length,pl=m.events.filter(e=>e.result==='lose').length;pointWins+=pw;pointLosses+=pl;const key=(m.opponentName||'对手').trim().toLocaleLowerCase();let row=map.get(key);if(!row){row={name:m.opponentName||'对手',matches:0,wins:0,losses:0,active:0,pointWins:0,pointLosses:0,opponentTech:new Map()};map.set(key,row);}row.matches++;row.pointWins+=pw;row.pointLosses+=pl;for(const event of m.events)if(event.opponentTechnique)row.opponentTech.set(event.opponentTechnique,(row.opponentTech.get(event.opponentTechnique)||0)+1);if(!st.finished)row.active++;else if(st.won>st.lost){row.wins++;wins++;}else row.losses++;}
    for(const row of map.values())row.opponentTech=[...row.opponentTech.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([name,count])=>`${name} ${count}`).join('、')||'未记录';
    return {opponents:[...map.values()],wins,pointWins,pointLosses};
  }
  function renderSessionReport() {
    if(!session)return;const aggregate=sessionStats(session);
    $('session-report-title').textContent=session.title||'训练场次';$('session-report-subtitle').textContent=`${session.date} · ${session.playerName} · 对手：${[...new Set(session.matches.map(m=>m.opponentName||'对手'))].join('、')}`;
    $('session-status').textContent=session.status==='completed'?'已结束':'进行中';$('session-match-count').textContent=session.matches.length;$('session-win-count').textContent=aggregate.wins;$('session-point-wins').textContent=aggregate.pointWins;$('session-point-losses').textContent=aggregate.pointLosses;
    $('session-matches').innerHTML=session.matches.map((m,i)=>{const st=stateOf(m),score=st.games.map(g=>`${g.scoreUs}:${g.scoreOpponent}`).join('，')||`${st.us}:${st.opponent}`,result=!st.finished?'进行中':st.won>st.lost?'我方胜':'对方胜';return `<button class="session-match-row" type="button" data-match-id="${esc(m.matchId)}"><span class="session-match-index">${String(i+1).padStart(2,'0')}</span><span class="session-row-main"><b>${esc(m.opponentName||'对手')}</b><small>${esc(fmt(m.rules))} · ${esc(score)}</small></span><span class="session-row-result">${result}　查看 →</span></button>`;}).join('');
    $('opponent-summary').innerHTML=`<div class="region-heading opponent-heading"><span>对手</span><span>场次 / 战绩</span><span>我方得 / 失分</span><span>已记录对方技术</span></div>${aggregate.opponents.map(o=>`<div class="region-line opponent-line"><span>${esc(o.name)}</span><span>${o.matches} 场 · ${o.wins} 胜 ${o.losses} 负${o.active?` · ${o.active} 场进行中`:''}</span><span>${o.pointWins} / ${o.pointLosses}</span><span>${esc(o.opponentTech)}</span></div>`).join('')}`;
    $('session-next').textContent=session.status==='completed'?'继续添加比赛':'添加下一场比赛';
  }
  function openSession(id){session=sessions.find(s=>s.sessionId===id)||null;if(!session)return;match=session.matches.find(m=>m.matchId===session.currentMatchId)||session.matches.at(-1);if(session.status==='active'){pendingAreaId=match.waitingAreaEventId||null;render();}else{match=null;renderSessionReport();showScreen('session');}}
  function openSessionSummary(id){session=sessions.find(s=>s.sessionId===id)||null;if(!session)return;match=null;renderSessionReport();showScreen('session');}
  function openHome(){session=null;match=null;pendingAreaId=null;renderHistory();announce('');showScreen('home');}
  function openNextDialog(){if(!session)return;const source=match||session.matches.find(m=>m.matchId===session.currentMatchId)||session.matches.at(-1);$('next-opponent').value='';$('next-format').value=`${source?.rules.mode||'official'}:${source?.rules.targetScore||21}`;$('next-match-dialog').showModal();$('next-opponent').focus();}
  function endSession(){if(!session||!window.confirm('结束本次训练场次？保存的比赛仍可在训练记录中查看。'))return;const next={...session,status:'completed'};if(!persist(sessions.map(s=>s.sessionId===session.sessionId?next:s)))return;session=next;renderHistory();renderSessionReport();showScreen('session');}
  function download(content,type,ext){const slug=String(session.title||'羽毛球训练').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,'-'),blob=new Blob([content],{type:`${type};charset=utf-8`}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${session.date}-${slug}.${ext}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);announce(`已导出 ${ext.toUpperCase()} 记录，可保存后提交给大模型分析。`);}
  function exportJSON(){if(session)download(JSON.stringify(session,null,2),'application/json','json');}
  function exportMarkdown(){if(!session)return;const a=sessionStats(session),lines=[`# 羽毛球训练记录：${session.title||session.date}`,'',`- 日期：${session.date}`,`- 我方：${session.playerName}`,`- 状态：${session.status==='completed'?'已结束':'进行中'}`,`- 比赛场数：${session.matches.length}`,`- 我方胜场：${a.wins}`,`- 我方得分 / 失分：${a.pointWins} / ${a.pointLosses}`,'','## 逐场摘要','','| 场次 | 对手 | 计分规则 | 比分（我方:对方） | 结果 |','|---:|---|---|---|---|'];
    session.matches.forEach((m,i)=>{const st=stateOf(m),score=st.games.map(g=>`${g.scoreUs}:${g.scoreOpponent}`).join('，')||`${st.us}:${st.opponent}`,result=!st.finished?'进行中':st.won>st.lost?'我方胜':'对方胜';lines.push(`| ${i+1} | ${(m.opponentName||'对手').replace(/\|/g,'\\|')} | ${fmt(m.rules)} | ${score} | ${result} |`);});
    lines.push('','## 按对手汇总','','| 对手 | 场次 | 我方胜场 | 我方得分 | 我方失分 | 已记录对手技术 |','|---|---:|---:|---:|---:|---|');a.opponents.forEach(o=>lines.push(`| ${o.name} | ${o.matches} | ${o.wins} | ${o.pointWins} | ${o.pointLosses} | ${o.opponentTech} |`));
    session.matches.forEach((m,i)=>{lines.push('',`## 第 ${i+1} 场：${m.opponentName||'对手'}`,'',`- 规则：${fmt(m.rules)}`,`- 记录时间：${m.createdAt}`,'','| 局数 | 局内分序号 | 我方得失分 | 我方最后技术 | 已记录的对手技术 | 主要原因 / 终结结果 | 观察到的前置因果链 | 区域 | 时间 |','|---:|---:|---|---|---|---|---|---|---|');m.events.forEach(e=>lines.push(`| ${e.gameNumber} | ${e.rallyNumber} | ${e.result==='win'?'我方得分':'我方失分'} | ${e.technique} | ${e.opponentTechnique||'未记录'} | ${e.reason} | ${e.result==='lose'?(e.lossCauses?.length?core.lossChain(e):'前置原因未记录'):'不适用'} | ${e.area||'未记录'} | ${e.timestamp} |`));});
    lines.push('','## 请大模型分析','','请只根据以上记录分析我方稳定得分方式、主要失分点、对手技术特点和对不同对手的表现差异。对手技术一栏只包含记录员主动补记的数据；未记录的技术不要推断为不存在。前置原因按记录员观察顺序保存，与主要原因关联于同一失分回合；这是观察记录，不是已验证的因果结论。未补记的旧记录保持未知，不得凭最后一拍推断失位或回球过浅。请区分终结结果与前置问题，区分事实与推测，数据不足时说明不足。');download(lines.join('\n'),'text/markdown','md');}

  function onResult(result){if(busy||!match||stateOf(match).finished)return;if(pendingAreaId){const c={...match,waitingAreaEventId:null};if(!saveMatch(c))return;match=c;pendingAreaId=null;renderScore();}selection={result,technique:null};$('result-choices').hidden=true;$('choice-panel').hidden=false;$('entry-title').textContent='选择我方最后执行的技术';$('entry-step').textContent='02 / 03';$('choice-label').textContent=`我方${result==='win'?'得分':'失分'} · 技术动作`;showChoices(core.techniques,t=>{selection.technique=t;$('entry-title').textContent='选择这一分的主要原因';$('entry-step').textContent='03 / 03';$('choice-label').textContent=`我方${result==='win'?'得分':'失分'} · 主要原因`;showChoices(core.reasons[result],savePoint);});}
  function showChoices(labels,callback){const box=$('choices');box.replaceChildren(...labels.map(label=>{const b=document.createElement('button');b.className='choice-button';b.type='button';b.textContent=label;b.addEventListener('click',()=>callback(label));return b;}));}
  function savePoint(reason){if(busy||!selection.result||!selection.technique)return;busy=true;try{const c=core.add(match,selection.result,selection.technique,reason),id=c.events.at(-1).id;c.waitingAreaEventId=stateOf(c).finished?null:id;if(commit(c)){pendingAreaId=match.waitingAreaEventId;resetSelection();announce('');render();}}catch(e){announce(e.message||'本次记录未完成',true);}finally{busy=false;}}

  $('session-date').value=today();
  $('start-form').addEventListener('submit',e=>{e.preventDefault();const form=new FormData(e.currentTarget),date=String(form.get('sessionDate')||today()),player=String(form.get('playerName')||'').trim()||'我方',title=String(form.get('sessionTitle')||'').trim()||`${date} 羽毛球练习`,first=core.createMatch(player,form.get('opponentName'),selectedRules),now=new Date().toISOString(),s={sessionId:uid(),date,title,playerName:player,createdAt:now,updatedAt:now,status:'active',currentMatchId:first.matchId,matches:[first]};if(persist([...sessions,s])){session=s;match=first;pendingAreaId=null;resetSelection();renderHistory();render();}});
  $('home-button').addEventListener('click',openHome);$('report-session').addEventListener('click',()=>{renderSessionReport();showScreen('session');});$('report-new').addEventListener('click',openNextDialog);$('session-next').addEventListener('click',openNextDialog);$('session-back').addEventListener('click',openHome);$('session-finish').addEventListener('click',endSession);
  $('next-match-form').addEventListener('submit',e=>{e.preventDefault();if(!session)return;const [mode,target]=$('next-format').value.split(':'),m=core.createMatch(session.playerName,$('next-opponent').value,{mode,targetScore:Number(target)}),s={...session,status:'active',currentMatchId:m.matchId,matches:[...session.matches,m]};if(persist(sessions.map(x=>x.sessionId===session.sessionId?s:x))){session=s;match=m;pendingAreaId=null;resetSelection();$('next-match-dialog').close();renderHistory();render();}});
  $('cancel-next-match').addEventListener('click',()=>$('next-match-dialog').close());$('next-match-dialog').addEventListener('click',e=>{if(e.target===$('next-match-dialog'))$('next-match-dialog').close();});$('session-json').addEventListener('click',exportJSON);$('session-markdown').addEventListener('click',exportMarkdown);
  $('session-list').addEventListener('click',e=>{const summary=e.target.closest('[data-session-summary-id]');if(summary){openSessionSummary(summary.dataset.sessionSummaryId);return;}const b=e.target.closest('[data-session-id]');if(b)openSession(b.dataset.sessionId);});$('session-matches').addEventListener('click',e=>{const b=e.target.closest('[data-match-id]');if(b&&session){match=session.matches.find(m=>m.matchId===b.dataset.matchId)||null;if(match){pendingAreaId=null;render();}}});
  $('report-undo').addEventListener('click',()=>{if(match?.events.length&&!busy&&commit({...core.undo(match),waitingAreaEventId:null})){pendingAreaId=null;announce('已撤销上一分');}});$('undo-button').addEventListener('click',()=>{if(match?.events.length&&!busy&&commit({...core.undo(match),waitingAreaEventId:null}))announce('已撤销上一分');});
  $('skip-area').addEventListener('click',()=>{const c={...match,waitingAreaEventId:null};if(saveMatch(c)){match=c;pendingAreaId=null;renderScore();announce('');}});$('continue-match').addEventListener('click',render);
  $('final-area');$('back-step').addEventListener('click',()=>{if(selection.technique){selection.technique=null;$('entry-title').textContent='选择我方最后执行的技术';$('entry-step').textContent='02 / 03';$('choice-label').textContent=`我方${selection.result==='win'?'得分':'失分'} · 技术动作`;showChoices(core.techniques,t=>{selection.technique=t;$('entry-title').textContent='选择这一分的主要原因';$('entry-step').textContent='03 / 03';$('choice-label').textContent=`我方${selection.result==='win'?'得分':'失分'} · 主要原因`;showChoices(core.reasons[selection.result],savePoint);});}else resetSelection();});
  document.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',()=>onResult(b.dataset.result)));document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));document.querySelectorAll('#official-scores [data-target]').forEach(b=>b.addEventListener('click',()=>setTarget(b.dataset.target)));
  [5,7,11,15,21].forEach(target=>{const b=document.createElement('button');b.className='free-score-button';b.type='button';b.dataset.target=String(target);b.textContent=`${target} 分`;b.addEventListener('click',()=>setTarget(target));document.querySelector('.free-score-buttons').append(b);});
  setMode('official');
  try{sessions=readSessions();renderHistory();const active=sessions.filter(s=>s.status==='active').sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0];if(active)openSession(active.sessionId);else showScreen('home');}
  catch(e){announce(e.message,true);$('start-form').querySelector('button[type="submit"]').disabled=true;showScreen('home');}
})();
