#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { loadDotEnvIntoProcess } = require('./load-env.cjs');

loadDotEnvIntoProcess({ cwd: process.cwd() });

const DEFAULT_DB = 'mysql://app:app_pw@127.0.0.1:3306/typing_quiz_app';
const DATABASE_URL = process.env.EXPORT_DATABASE_URL || DEFAULT_DB;
const OUTPUT = path.resolve(process.cwd(), process.env.EXPORT_OUTPUT || 'exports/numbering-pro-standalone.html');
const EXPORT_USER_ID = process.env.EXPORT_USER_ID ? Number(process.env.EXPORT_USER_ID) : null;
const EXPORT_USERNAME = process.env.EXPORT_USERNAME || null;
const EXPORT_SUBJECT_IDS = (process.env.EXPORT_SUBJECT_IDS || '')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v > 0);
const INCLUDE_DEMO = process.env.EXPORT_INCLUDE_DEMO === 'true';
const APP_TITLE = process.env.EXPORT_TITLE || 'numbering.pro standalone';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function findLocalImagePath(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  if (/^data:/i.test(imageUrl)) return null;
  if (/^https?:\/\//i.test(imageUrl)) return null;
  const clean = imageUrl.split('?')[0].replace(/^\/+/, '');
  const candidates = [];
  if (clean.startsWith('uploads/')) {
    const rel = clean.replace(/^uploads\//, '');
    candidates.push(path.resolve(process.cwd(), 'var/uploads', rel));
    candidates.push(path.resolve(process.cwd(), 'client/public/uploads', rel));
    candidates.push(path.resolve(process.cwd(), 'dist/public/uploads', rel));
  }
  if (clean.startsWith('demo-assets/')) {
    candidates.push(path.resolve(process.cwd(), 'client/public', clean));
    candidates.push(path.resolve(process.cwd(), 'dist/public', clean));
  }
  candidates.push(path.resolve(process.cwd(), 'client/public', clean));
  candidates.push(path.resolve(process.cwd(), clean));
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function embedImageUrl(imageUrl, warnings, questionId) {
  if (!imageUrl) return null;
  if (/^data:/i.test(imageUrl)) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const localPath = findLocalImagePath(imageUrl);
  if (!localPath) {
    warnings.push(`Q${questionId}: image not embedded (${imageUrl})`);
    return imageUrl;
  }
  const bytes = fs.readFileSync(localPath);
  const mime = mimeFromExt(localPath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function inferQuestionType(q) {
  if (q.tableData) return 'table';
  if (q.imageUrl || q.imageLabels) return 'image';
  if (/\[[^\]]+\]/.test(q.answer || '') || /\[[^\]]+\]/.test(q.question || '')) return 'blank';
  return 'text';
}

function normalizeQuestion(row, warnings) {
  const tableData = parseJson(row.tableData, null);
  const imageLabels = parseJson(row.imageLabels, []);
  return {
    id: row.id,
    subjectId: row.subjectId,
    order: row.displayOrder || 0,
    type: inferQuestionType(row),
    title: row.question || '',
    answer: row.answer || '',
    autoNumbering: row.autoNumbering === 1,
    isStarred: row.isStarred === 1,
    memo: row.memo || '',
    imageUrl: embedImageUrl(row.imageUrl, warnings, row.id),
    imageLabels: Array.isArray(imageLabels) ? imageLabels : [],
    tableData,
  };
}

async function getExportUser(conn) {
  if (EXPORT_USER_ID) {
    const [rows] = await conn.query('SELECT * FROM users WHERE id = ? LIMIT 1', [EXPORT_USER_ID]);
    if (!rows[0]) throw new Error(`EXPORT_USER_ID not found: ${EXPORT_USER_ID}`);
    return rows[0];
  }
  if (EXPORT_USERNAME) {
    const [rows] = await conn.query('SELECT * FROM users WHERE username = ? LIMIT 1', [EXPORT_USERNAME]);
    if (!rows[0]) throw new Error(`EXPORT_USERNAME not found: ${EXPORT_USERNAME}`);
    return rows[0];
  }
  const [rows] = await conn.query(`
    SELECT * FROM users
    WHERE username IS NOT NULL OR email IS NOT NULL
    ORDER BY lastSignedIn DESC, id DESC
    LIMIT 1
  `);
  if (!rows[0]) throw new Error('No exportable user found');
  return rows[0];
}

async function loadData() {
  const conn = await mysql.createConnection(DATABASE_URL);
  try {
    const user = await getExportUser(conn);
    const subjectWhere = ['s.userId = ?'];
    const params = [user.id];
    if (!INCLUDE_DEMO) subjectWhere.push('s.isDemo = 0');
    if (EXPORT_SUBJECT_IDS.length > 0) {
      subjectWhere.push(`s.id IN (${EXPORT_SUBJECT_IDS.map(() => '?').join(',')})`);
      params.push(...EXPORT_SUBJECT_IDS);
    }
    const [subjects] = await conn.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM questions q WHERE q.subjectId = s.id) AS questionCount
      FROM subjects s
      WHERE ${subjectWhere.join(' AND ')}
      ORDER BY s.displayOrder, s.id
    `, params);
    const subjectIds = subjects.map((s) => s.id);
    if (subjectIds.length === 0) throw new Error('No subjects to export');
    const [questions] = await conn.query(`
      SELECT * FROM questions
      WHERE subjectId IN (${subjectIds.map(() => '?').join(',')})
      ORDER BY subjectId, displayOrder, id
    `, subjectIds);
    const warnings = [];
    const questionsBySubject = new Map();
    for (const q of questions) {
      const normalized = normalizeQuestion(q, warnings);
      const arr = questionsBySubject.get(q.subjectId) || [];
      arr.push(normalized);
      questionsBySubject.set(q.subjectId, arr);
    }
    return {
      meta: {
        title: APP_TITLE,
        exportedAt: new Date().toISOString(),
        sourceUser: { id: user.id, username: user.username, email: user.email, name: user.name },
      },
      subjects: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        color: s.color || '#111111',
        examEndDate: s.examEndDate ? new Date(s.examEndDate).toISOString() : null,
        questions: questionsBySubject.get(s.id) || [],
      })),
      warnings,
    };
  } finally {
    await conn.end();
  }
}

function buildHtml(payload) {
  const dataJson = safeJsonScript(payload);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.meta.title)}</title>
  <style>
    :root{--bg:#f5f6f8;--paper:#ffffff;--ink:#171717;--muted:#6f737b;--line:#d9dde5;--accent:#111;--green:#18885d;--yellow:#9b7100;--red:#b73a3a;--soft:#f0f2f5;--shadow:0 18px 42px rgba(15,23,42,.10)}
    *{box-sizing:border-box} body{margin:0;background:linear-gradient(180deg,#f7f8fb 0,#eef1f5 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',system-ui,sans-serif;line-height:1.55} button,input,textarea,select{font:inherit} button{cursor:pointer}
    .app{max-width:1200px;margin:0 auto;padding:28px 20px 80px}.top{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:26px}.brand{font-family:ui-sans-serif,system-ui,sans-serif;font-size:46px;font-weight:900;letter-spacing:-.06em;line-height:.95}.tag{color:var(--muted);font-weight:700;margin-top:8px}.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:rgba(255,255,255,.68);border-radius:999px;padding:8px 12px;color:#504e49;font-size:13px}.layout{display:grid;grid-template-columns:320px minmax(0,1fr);gap:18px}.panel{background:rgba(255,253,248,.86);border:1px solid var(--line);border-radius:26px;box-shadow:var(--shadow);overflow:hidden}.side{padding:18px;position:sticky;top:18px;max-height:calc(100vh - 36px);overflow:auto}.main{min-height:680px;padding:22px}.search{width:100%;border:1px solid var(--line);border-radius:16px;background:#fff;padding:12px 14px;margin:12px 0 16px}.subject{width:100%;text-align:left;border:1px solid var(--line);background:#fffaf0;border-radius:18px;padding:14px;margin:8px 0;transition:.15s}.subject:hover,.subject.active{transform:translateY(-1px);border-color:#222;box-shadow:0 8px 20px rgba(0,0,0,.08)}.subject h3{margin:0;font-size:18px}.subject small{color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0 18px}.stat{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:12px}.stat b{display:block;font-size:24px}.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}.btn{border:1px solid #191919;background:#191919;color:#fff;border-radius:14px;padding:10px 14px;font-weight:800}.btn.secondary{background:#fff;color:#191919;border-color:var(--line)}.btn.ghost{background:transparent;color:#191919;border-color:transparent}.btn.danger{background:#8f1d1d;border-color:#8f1d1d}.qgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.qcard{border:1px solid var(--line);background:#fff;border-radius:20px;padding:14px;text-align:left;min-height:138px;position:relative}.qcard:hover{border-color:#222}.qtitle{font-weight:850;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.qmeta{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.badge{font-family:ui-sans-serif,system-ui,sans-serif;font-size:12px;border-radius:999px;padding:4px 8px;background:#f0eee8;color:#555}.badge.green{background:#e8f5ee;color:var(--green)}.badge.red{background:#fae9e9;color:var(--red)}.badge.yellow{background:#fff3ce;color:var(--yellow)}.questionHead{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:16px}.questionTitle{font-size:28px;font-weight:900;letter-spacing:-.03em;margin:0}.answerBox,.inputBox,.resultBox{border:1px solid var(--line);border-radius:20px;background:#fff;padding:16px}.answerBox{white-space:pre-wrap}.inputBox textarea{width:100%;min-height:220px;border:0;outline:0;resize:vertical;background:linear-gradient(to bottom,transparent 30px,rgba(0,0,0,.045) 31px);line-height:31px;padding:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px}.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.checkLine{border-top:1px solid var(--line);padding:10px 0}.ok{color:var(--green);font-weight:900}.bad{color:var(--red);font-weight:900}.muted{color:var(--muted)}.hidden{display:none!important}.tableWrap{overflow:auto;border:1px solid var(--line);border-radius:18px;background:#fff}.quizTable{border-collapse:collapse;width:100%;min-width:620px}.quizTable td,.quizTable th{border:1px solid var(--line);padding:8px;vertical-align:middle}.quizTable input{width:100%;border:1px solid #ddd;border-radius:10px;padding:8px}.imageStage{position:relative;background:#fff;border:1px solid var(--line);border-radius:20px;padding:12px;overflow:auto}.imageStage img{display:block;max-width:100%;height:auto;margin:auto}.labelDot{position:absolute;transform:translate(-50%,-50%);background:#111;color:#fff;border-radius:999px;width:28px;height:28px;display:grid;place-items:center;font-weight:900;font-family:ui-sans-serif,system-ui,sans-serif}.reviewEmpty{padding:44px;text-align:center;color:var(--muted)}.footer{margin-top:28px;color:#85827b;font-size:12px;text-align:center}@media(max-width:820px){.layout{grid-template-columns:1fr}.side{position:static;max-height:none}.split{grid-template-columns:1fr}.brand{font-size:36px}.stats{grid-template-columns:repeat(2,1fr)}.questionTitle{font-size:22px}}
  </style>
</head>
<body>
  <div class="app">
    <div class="top">
      <div><div class="brand">numbering.pro</div><div class="tag">Number it. Remember it like a pro.</div></div>
      <div class="pill">단일 HTML · 오프라인 저장 · 오답 자동 복습</div>
    </div>
    <div class="layout">
      <aside class="panel side">
        <div class="pill" id="exportInfo"></div>
        <input class="search" id="search" placeholder="과목/문제 검색" />
        <div class="toolbar"><button class="btn secondary" id="showWrongBtn">오답 복습</button><button class="btn ghost" id="homeBtn">전체</button></div>
        <div id="subjects"></div>
      </aside>
      <main class="panel main" id="main"></main>
    </div>
    <div class="footer">본 자료는 내부 학습용이며, 요청 시 삭제됩니다. 진행 기록은 이 브라우저에만 저장됩니다.</div>
  </div>
  <script id="payload" type="application/json">${dataJson}</script>
  <script>
  const DATA = JSON.parse(document.getElementById('payload').textContent);
  const STORE_KEY = 'numbering-pro-standalone:' + DATA.meta.exportedAt + ':' + DATA.meta.sourceUser.id;
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const state = { subjectId: DATA.subjects[0]?.id ?? null, questionId: null, mode: 'home', query: '', showAnswer: true, result: null, tableAnswers: {}, labelAnswers: {} };
  const NL = String.fromCharCode(10);
  let progress = loadProgress();
  function loadProgress(){ try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } }
  function saveProgress(){ localStorage.setItem(STORE_KEY, JSON.stringify(progress)); }
  function allQuestions(){ return DATA.subjects.flatMap(s => s.questions.map(q => ({...q, subjectName:s.name}))); }
  function subject(){ return DATA.subjects.find(s => s.id === state.subjectId) || DATA.subjects[0]; }
  function question(){ return allQuestions().find(q => q.id === state.questionId); }
  function norm(s){ return String(s||'').toLowerCase().replace(/^\s*\d{1,3}\s*[.)]\s*/gm,'').replace(/^\s*[-–—*•·]\s*/gm,'').replace(/[\p{P}\p{S}\s]/gu,''); }
  function lineNorms(s){ return String(s||'').split(NL).map(v=>norm(v)).filter(Boolean); }
  function scoreText(user, answer){ const rawAnswer=String(answer||'').split(NL).filter(l=>norm(l)); const rawUser=String(user||'').split(NL).filter(l=>norm(l)); const a=lineNorms(answer), u=lineNorms(user); const lines=a.map((correct,i)=>{ const own=u[i]||''; let best=own, bestIdx=i, bestScore=sim(own,correct); for(let j=0;j<u.length;j++){ const sc=sim(u[j],correct); if(sc>bestScore && sc>=80){best=u[j];bestIdx=j;bestScore=sc;} } return {i, correctRaw:rawAnswer[i]||'', userRaw:rawUser[bestIdx]||'', score:bestScore, ok:bestScore>=92}; }); const ok=lines.filter(l=>l.ok).length; return {ok, total:a.length||1, pct:Math.round(ok/Math.max(1,a.length)*100), lines}; }
  function sim(a,b){ if(!a&&!b)return 100; if(!a||!b)return 0; const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0)); for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]); return Math.round(dp[m][n]/Math.max(m,n)*100); }
  function qProgress(id){ return progress[id] || { attempts:0, correct:0, wrong:false, lastPct:null, updatedAt:null }; }
  function setQProgress(id, patch){ progress[id] = { ...qProgress(id), ...patch, updatedAt:new Date().toISOString() }; saveProgress(); }
  function resetQuestionState(){ state.result=null; state.tableAnswers={}; state.labelAnswers={}; state.showAnswer=true; }
  function render(){ renderSide(); if(state.mode==='wrong') renderWrong(); else if(state.questionId) renderQuestion(); else renderHome(); }
  function renderSide(){ $('#exportInfo').textContent = DATA.subjects.length + '과목 · ' + allQuestions().length + '문제'; const root=$('#subjects'); root.innerHTML=''; DATA.subjects.forEach(s=>{ const qs=s.questions; const done=qs.filter(q=>qProgress(q.id).correct>0).length; const wrong=qs.filter(q=>qProgress(q.id).wrong).length; const b=document.createElement('button'); b.className='subject'+(s.id===state.subjectId?' active':''); b.innerHTML='<h3>'+escape(s.name)+'</h3><small>'+qs.length+'문제 · 완료 '+done+' · 오답 '+wrong+'</small>'; b.onclick=()=>{state.subjectId=s.id; state.questionId=null; state.mode='home'; resetQuestionState(); render();}; root.appendChild(b); }); }
  function filteredQuestions(qs){ const query=state.query.trim().toLowerCase(); if(!query) return qs; return qs.filter(q => (q.title+' '+q.answer+' '+q.subjectName).toLowerCase().includes(query)); }
  function renderHome(){ const s=subject(); const qs=filteredQuestions(s.questions.map(q=>({...q,subjectName:s.name}))); const done=s.questions.filter(q=>qProgress(q.id).correct>0).length; const wrong=s.questions.filter(q=>qProgress(q.id).wrong).length; $('#main').innerHTML='<div class="questionHead"><div><h1 class="questionTitle">'+escape(s.name)+'</h1><p class="muted">'+escape(s.description||'파일로 공유된 문제 세트')+'</p></div><button class="btn" id="startBtn">시작</button></div><div class="stats"><div class="stat"><b>'+s.questions.length+'</b>전체</div><div class="stat"><b>'+done+'</b>완료</div><div class="stat"><b>'+wrong+'</b>오답</div><div class="stat"><b>'+Math.round(done/Math.max(1,s.questions.length)*100)+'%</b>진행</div></div><div class="qgrid">'+qs.map(q=>qCard(q)).join('')+'</div>';
    $('#startBtn').onclick=()=>openQuestion(qs[0]?.id); $$('.qcard').forEach(el=>el.onclick=()=>openQuestion(Number(el.dataset.id))); }
  function qCard(q){ const p=qProgress(q.id); const cls=p.wrong?'red':p.correct?'green':p.lastPct>=60?'yellow':''; const type=q.type==='table'?'표':q.type==='image'?'그림':q.type==='blank'?'빈칸':'넘버링'; return '<button class="qcard" data-id="'+q.id+'"><div class="qtitle">'+escape(q.title)+'</div><div class="qmeta"><span class="badge">'+type+'</span>'+(q.isStarred?'<span class="badge">★ 중요</span>':'')+'<span class="badge '+cls+'">'+(p.lastPct==null?'미학습':p.lastPct+'점')+'</span>'+(p.wrong?'<span class="badge red">오답</span>':'')+'</div></button>'; }
  function openQuestion(id){ if(!id)return; state.questionId=id; state.mode='question'; resetQuestionState(); render(); }
  function renderQuestion(){ const q=question(); if(!q){state.questionId=null; renderHome(); return;} const qs=subject().questions; const idx=qs.findIndex(x=>x.id===q.id); $('#main').innerHTML='<div class="questionHead"><div><button class="btn ghost" id="backBtn">← 목록</button><h1 class="questionTitle">'+escape(q.title)+'</h1><p class="muted">'+escape(q.subjectName)+' · '+(idx+1)+' / '+qs.length+'</p></div><div class="toolbar"><button class="btn secondary" id="prevBtn">이전</button><button class="btn secondary" id="nextBtn">다음</button></div></div><div id="questionBody"></div>';
    $('#backBtn').onclick=()=>{state.questionId=null; render();}; $('#prevBtn').onclick=()=>openQuestion(qs[Math.max(0,idx-1)]?.id); $('#nextBtn').onclick=()=>openQuestion(qs[Math.min(qs.length-1,idx+1)]?.id); renderQuestionBody(q); }
  function renderQuestionBody(q){ if(q.type==='table' && q.tableData) return renderTableQuestion(q); if(q.type==='image') return renderImageQuestion(q); return renderTextQuestion(q); }
  function renderTextQuestion(q){ $('#questionBody').innerHTML='<div class="toolbar"><button class="btn secondary" id="toggleAnswer">정답 '+(state.showAnswer?'가리기':'보기')+'</button><button class="btn" id="checkBtn">채점</button><button class="btn secondary" id="markWrong">오답으로 표시</button></div><div class="split"><div class="answerBox '+(state.showAnswer?'':'hidden')+'"><b>정답</b><br>'+escape(q.answer)+'</div><div class="inputBox"><textarea id="answerInput" placeholder="답을 입력하세요. 띄어쓰기와 기호는 대체로 무시돼요."></textarea></div></div><div id="result"></div>';
    $('#toggleAnswer').onclick=()=>{state.showAnswer=!state.showAnswer; renderTextQuestion(q);}; $('#markWrong').onclick=()=>{setQProgress(q.id,{wrong:true}); render();}; $('#checkBtn').onclick=()=>{const user=$('#answerInput').value; const r=scoreText(user,q.answer); state.result=r; setQProgress(q.id,{attempts:qProgress(q.id).attempts+1,correct:qProgress(q.id).correct+(r.pct>=90?1:0),wrong:r.pct<90,lastPct:r.pct}); renderTextQuestion(q); $('#answerInput').value=user; renderTextResult(r);}; if(state.result) renderTextResult(state.result); }
  function renderTextResult(r){ $('#result').innerHTML='<div class="resultBox" style="margin-top:14px"><h3>결과 '+r.pct+'점 · '+r.ok+'/'+r.total+'</h3>'+r.lines.map((l,i)=>'<div class="checkLine"><b class="'+(l.ok?'ok':'bad')+'">'+(l.ok?'✓':'✗')+' '+(i+1)+'번째 줄 · '+l.score+'점</b><div><span class="muted">정답:</span> '+escape(l.correctRaw)+'</div><div><span class="muted">내 답:</span> '+escape(l.userRaw||'(입력 없음)')+'</div></div>').join('')+'</div>'; }
  function blankKeys(table){ const keys=[]; (table.cells||[]).forEach((row,r)=>row.forEach((cell,c)=>{ if(cell && cell.isBlank && !cell.isMerged) keys.push(r+'-'+c); })); return keys; }
  function renderTableQuestion(q){ const table=q.tableData; const keys=blankKeys(table); const html=(table.cells||[]).map((row,r)=>'<tr>'+row.map((cell,c)=>{ const key=r+'-'+c; const blank=keys.includes(key); return '<td>'+(blank?'<input data-cell="'+key+'" value="'+escape(state.tableAnswers[key]||'')+'" placeholder="답">':escape(cell?.content||''))+'</td>'; }).join('')+'</tr>').join(''); $('#questionBody').innerHTML='<div class="toolbar"><button class="btn" id="checkTable">채점</button><button class="btn secondary" id="markWrong">오답으로 표시</button></div><div class="tableWrap"><table class="quizTable">'+html+'</table></div><div id="result"></div>'; $$('input[data-cell]').forEach(inp=>inp.oninput=()=>state.tableAnswers[inp.dataset.cell]=inp.value); $('#markWrong').onclick=()=>{setQProgress(q.id,{wrong:true}); render();}; $('#checkTable').onclick=()=>{let ok=0; const rows=keys.map(key=>{ const [r,c]=key.split('-').map(Number); const correct=table.cells?.[r]?.[c]?.content||''; const user=state.tableAnswers[key]||''; const good=norm(user)===norm(correct); if(good) ok++; return {key,correct,user,good};}); const pct=Math.round(ok/Math.max(1,keys.length)*100); setQProgress(q.id,{attempts:qProgress(q.id).attempts+1,correct:qProgress(q.id).correct+(pct>=90?1:0),wrong:pct<90,lastPct:pct}); $('#result').innerHTML='<div class="resultBox" style="margin-top:14px"><h3>결과 '+pct+'점 · '+ok+'/'+keys.length+'</h3>'+rows.map((r,i)=>'<div class="checkLine"><b class="'+(r.good?'ok':'bad')+'">'+(r.good?'✓':'✗')+' '+r.key+'</b><div>정답: '+escape(r.correct)+'</div><div>내 답: '+escape(r.user||'(입력 없음)')+'</div></div>').join('')+'</div>'; renderSide();}; }
  function renderImageQuestion(q){ const labels=q.imageLabels||[]; const dots=labels.map((l,i)=>'<span class="labelDot" style="left:'+(l.x||0)+'%;top:'+(l.y||0)+'%">'+(i+1)+'</span>').join(''); $('#questionBody').innerHTML='<div class="toolbar"><button class="btn secondary" id="toggleAnswer">정답 '+(state.showAnswer?'가리기':'보기')+'</button><button class="btn" id="checkImage">채점</button><button class="btn secondary" id="markWrong">오답으로 표시</button></div><div class="split"><div><div class="imageStage">'+(q.imageUrl?'<img src="'+q.imageUrl+'">'+dots:'<p class="muted">이미지 없음</p>')+'</div><div class="answerBox '+(state.showAnswer?'':'hidden')+'" style="margin-top:12px">'+labels.map((l,i)=>'<div><b>'+(i+1)+'.</b> '+escape(l.answer||'')+'</div>').join('')+'</div></div><div class="inputBox"><textarea id="imageInput" placeholder="번호별 정답을 줄마다 입력하세요"></textarea></div></div><div id="result"></div>'; $('#toggleAnswer').onclick=()=>{state.showAnswer=!state.showAnswer; renderImageQuestion(q);}; $('#markWrong').onclick=()=>{setQProgress(q.id,{wrong:true}); render();}; $('#checkImage').onclick=()=>{const lines=$('#imageInput').value.split(NL); let ok=0; const rows=labels.map((l,i)=>{const user=(lines[i]||'').replace(/^\s*\d+[.)]\s*/,''); const good=norm(user)===norm(l.answer||''); if(good)ok++; return {i,correct:l.answer||'',user,good};}); const pct=Math.round(ok/Math.max(1,labels.length)*100); setQProgress(q.id,{attempts:qProgress(q.id).attempts+1,correct:qProgress(q.id).correct+(pct>=90?1:0),wrong:pct<90,lastPct:pct}); $('#result').innerHTML='<div class="resultBox" style="margin-top:14px"><h3>결과 '+pct+'점 · '+ok+'/'+labels.length+'</h3>'+rows.map(r=>'<div class="checkLine"><b class="'+(r.good?'ok':'bad')+'">'+(r.good?'✓':'✗')+' '+(r.i+1)+'번</b><div>정답: '+escape(r.correct)+'</div><div>내 답: '+escape(r.user||'(입력 없음)')+'</div></div>').join('')+'</div>'; renderSide();}; }
  function renderWrong(){ const wrong=filteredQuestions(allQuestions().filter(q=>qProgress(q.id).wrong)); $('#main').innerHTML='<div class="questionHead"><div><h1 class="questionTitle">오답 복습</h1><p class="muted">틀린 문제는 자동으로 여기에 모입니다.</p></div><button class="btn danger" id="clearWrong">오답 목록 비우기</button></div>'+(wrong.length?'<div class="qgrid">'+wrong.map(q=>qCard(q)).join('')+'</div>':'<div class="reviewEmpty">아직 오답이 없습니다.</div>'); $('#clearWrong').onclick=()=>{Object.keys(progress).forEach(id=>progress[id].wrong=false); saveProgress(); render();}; $$('.qcard').forEach(el=>el.onclick=()=>openQuestion(Number(el.dataset.id))); }
  function escape(s){ return String(s??'').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  $('#search').oninput=(e)=>{state.query=e.target.value; render();}; $('#showWrongBtn').onclick=()=>{state.mode='wrong'; state.questionId=null; render();}; $('#homeBtn').onclick=()=>{state.mode='home'; state.questionId=null; render();};
  render();
  </script>
</body>
</html>`;
}

(async () => {
  const payload = await loadData();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, buildHtml(payload), 'utf8');
  const questionCount = payload.subjects.reduce((sum, s) => sum + s.questions.length, 0);
  console.log(`Exported ${payload.subjects.length} subjects / ${questionCount} questions`);
  console.log(`Output: ${OUTPUT}`);
  if (payload.warnings.length) {
    console.warn('Warnings:');
    for (const warning of payload.warnings) console.warn(`- ${warning}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
