"use strict";
// ============================================================
// script.js — Nine Men's Morris: Adversarial Search
// Implementasi mandiri Minimax + Alpha-Beta Pruning (from scratch)
// Referensi: Russell & Norvig, "AI: A Modern Approach" 4th ed, Bab 5
//
// Seksi:
//   1. Definisi papan & konstanta
//   2. Canvas setup & render
//   3. Efek suara (Web Audio API)
//   4. State permainan
//   5. Navigasi layar (menu → game → win)
//   6. Render canvas (papan, pion, animasi)
//   7. Logika aturan permainan
//   8. Input handler (klik & sentuh)
//   9. Aksi papan (place, move, remove)
//  10. Algoritma AI: Minimax & Alpha-Beta Pruning
//  11. Visualisasi Game Tree (SVG, 3 level)
//  12. UI & state helpers
// ============================================================


// ── 1. DEFINISI PAPAN ────────────────────────────────────────
// 24 titik pada grid 7×7 (baris, kolom) — tiga kotak bersarang
const NODE_POS = [
  [0,0],[0,3],[0,6],
  [3,0],      [3,6],
  [6,0],[6,3],[6,6],
  [1,1],[1,3],[1,5],
  [3,1],      [3,5],
  [5,1],[5,3],[5,5],
  [2,2],[2,3],[2,4],
  [3,2],      [3,4],
  [4,2],[4,3],[4,4]
];

// Adjacency list — node yang terhubung langsung
const ADJ = [
  [1,3],        // 0
  [0,2,9],      // 1
  [1,4],        // 2
  [0,5,11],     // 3
  [2,7,12],     // 4
  [3,6,13],     // 5
  [5,7,14],     // 6
  [4,6,15],     // 7
  [9,11],       // 8
  [1,8,10,17],  // 9
  [9,12],       // 10
  [3,8,13,19],  // 11
  [4,10,15,20], // 12
  [5,11,14],    // 13
  [6,13,15,22], // 14
  [7,12,14],    // 15
  [17,19],      // 16
  [9,16,18],    // 17
  [17,20],      // 18
  [11,16,21],   // 19
  [12,18,23],   // 20
  [19,22],      // 21
  [14,21,23],   // 22
  [20,22]       // 23
];

// 16 kombinasi mill (3 node sejajar)
const MILLS = [
  [0,1,2],[0,3,5],[2,4,7],[5,6,7],
  [8,9,10],[8,11,13],[10,12,15],[13,14,15],
  [16,17,18],[16,19,21],[18,20,23],[21,22,23],
  [1,9,17],[6,14,22],[3,11,19],[4,12,20]
];

const E = 0, W = 1, B = 2; // EMPTY, WHITE (human/P1), BLACK (AI/P2)


// ── 2. CANVAS SETUP ──────────────────────────────────────────
const cvs = document.getElementById('cvs');
const ctx = cvs.getContext('2d');

// Ukuran canvas = sisa tinggi kolom tengah setelah tree box & gaps
function resizeCanvas() {
  const isMobile = window.innerWidth <= 700;
  if (isMobile) {
    const sz = Math.min(window.innerWidth * 0.96, 400);
    cvs.width = cvs.height = sz;
  } else {
    const appHeader = document.querySelector('.app-header');
    const treeBox   = document.querySelector('.tree-box');
    const appBody   = document.querySelector('.app-body');
    if (!appHeader || !treeBox || !appBody) return;
    const headerH  = appHeader.offsetHeight;
    const bodyPadV = 8; // padding atas+bawah app-body
    const gapH     = 4; // gap antara board-wrap dan tree-box
    const treeH    = treeBox.offsetHeight;
    const availH   = window.innerHeight - headerH - bodyPadV - gapH - treeH - 8;
    // Lebar kolom tengah: total - 2 panel - 2 gap
    const panelW   = 190, gapW = 5;
    const availW   = window.innerWidth - 2*(panelW+gapW) - 10;
    const sz = Math.max(Math.min(availH, availW, 540), 200);
    cvs.width = cvs.height = sz;
  }
  if (typeof board !== 'undefined' && board) draw();
}
window.addEventListener('resize', resizeCanvas);


// ── 3. EFEK SUARA (Web Audio API — tanpa file eksternal) ──────
let audioCtx = null, muted = false;
function getAC() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function tone(freq, type, dur, vol, delay = 0) {
  if (muted) return;
  try {
    const ac = getAC(), o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = type; o.frequency.value = freq;
    const t = ac.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + .01);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.start(t); o.stop(t + dur + .05);
  } catch(e) {}
}
const sfx = {
  place  : () => { tone(260,'triangle',.12,.4); tone(180,'sine',.18,.2,.04); },
  move   : () => { tone(320,'sine',.09,.3); tone(400,'sine',.07,.2,.05); },
  mill   : () => { [523,659,784].forEach((f,i) => tone(f,'sine',.25,.35,i*.07)); },
  remove : () => { tone(150,'sawtooth',.12,.5); tone(100,'sine',.18,.3,.05); },
  win    : () => { [523,659,784,1047].forEach((f,i) => tone(f,'triangle',.4,.4,i*.12)); },
  lose   : () => { [330,262,196].forEach((f,i) => tone(f,'sawtooth',.3,.35,i*.15)); },
  select : () => tone(500,'sine',.06,.2),
  error  : () => tone(220,'square',.08,.15),
  btn    : () => tone(440,'sine',.06,.18),
};
function toggleMute() {
  muted = !muted;
  document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  document.getElementById('btn-mute').classList.toggle('muted', muted);
  sfx.btn();
}


// ── 4. STATE PERMAINAN ────────────────────────────────────────
let board, turn, handW, handB, onBrdW, onBrdB;
let selected, mustRemove, gameOver;
let gameMode = null; // 'hvai' | 'hvh'
let p1Name = 'Anda', p2Name = 'AI';
let scoreH = 0, scoreA = 0, totalG = 0;
let moveCount = 0, posHistory = [];
let aiTimer = null, tipIdx = 0;

// Pengaturan AI
// difficulty: 1=Mudah, 2=Sedang, 3=Sulit (tiap level punya depth & strategi berbeda)
let difficulty   = 2;
let aiDepth      = 2;      // kedalaman minimax (dari difficulty)
let useAlphaBeta = true;   // toggle Alpha-Beta pruning (Fitur 5)

// Counter node untuk perbandingan Minimax vs Alpha-Beta (Fitur 4)
let ncMinimax = 0, ncAlphaBeta = 0;

// Animasi langkah AI — node yang baru saja dipindahkan AI (Fitur 10/Bonus)
let animNode = -1, animTimer = null;

// Timer seri (langsung countdown 90 detik saat kondisi 3v3 terpenuhi)
const DRAW_WAIT_SECS     = 0;  // tidak ada fase tunggu
const DRAW_TIMER_SECS    = 90; // countdown 90 detik (1 menit 30 detik)
let drawTimerVal         = DRAW_TIMER_SECS;
let drawWaitVal          = 0;
let drawTimerInterval    = null;
let drawTimerActive      = false; // true saat countdown sedang berjalan
let drawWaitActive       = false; // tidak dipakai

// Konfigurasi tiap tingkat kesulitan
// Depth 3 untuk Sulit dipilih karena:
//   - Masih cukup cepat (~1-2 detik dengan Alpha-Beta)
//   - Pruning Alpha-Beta sudah sangat terlihat (~85% node dipangkas)
//   - Depth 4 terlalu lambat untuk pengalaman bermain yang nyaman
const DIFF_CFG = {
  1: { depth:1, label:'Mudah',  desc:'Minimax depth 1 · Gerakan agak acak' },
  2: { depth:2, label:'Sedang', desc:'Minimax depth 2 · Strategi dasar' },
  3: { depth:3, label:'Sulit',  desc:'Minimax depth 3 · Alpha-Beta · Kuat' },
};

// Tips singkat — di-rotate setiap giliran AI, tampil 1 baris saja
const TIPS = [
  "Buat dua Mill sekaligus agar lawan sulit memblokir.",
  "Utamakan titik tengah yang terhubung banyak.",
  "Titik persilangan (4 koneksi) sangat strategis.",
  "Buka & tutup Mill berulang untuk hapus pion lawan.",
  "Blokir hampir-Mill lawan sebelum terlambat.",
  "Pion ≤ 3? Kamu boleh terbang ke mana saja!",
  "Rencanakan 2 langkah ke depan.",
  "Pion dalam Mill tidak bisa dihapus lawan.",
];


// ── 5. NAVIGASI LAYAR ────────────────────────────────────────

function clickMode(mode) {
  sfx.btn(); gameMode = mode;
  document.getElementById('btn-hvai').classList.toggle('selected', mode === 'hvai');
  document.getElementById('btn-hvh').classList.toggle('selected', mode === 'hvh');
  document.getElementById('menu-diff-section').classList.toggle('hidden', mode === 'hvh');
  document.getElementById('menu-hint').style.opacity = '0';
}

function menuSetDiff(lv) {
  difficulty = lv; sfx.btn();
  [1,2,3].forEach(i => document.getElementById('md'+i).classList.toggle('active', i === lv));
  document.getElementById('menu-diff-desc').textContent = DIFF_CFG[lv].desc;
}

function goToHTP() {
  if (!gameMode) {
    const btn = document.getElementById('btn-lanjut');
    btn.style.animation = 'shake .4s';
    setTimeout(() => btn.style.animation = '', 400);
    sfx.error();
    document.getElementById('menu-hint').style.opacity = '1';
    return;
  }
  sfx.btn();
  document.getElementById('scr-menu').classList.remove('show');
  document.getElementById('scr-htp').classList.add('show');
}

function startGame() {
  sfx.btn();
  const cfg = DIFF_CFG[difficulty];
  aiDepth = cfg.depth;

  document.getElementById('scr-htp').classList.remove('show');
  p1Name = gameMode === 'hvai' ? 'Anda' : 'Pemain 1';
  p2Name = gameMode === 'hvai' ? 'AI'   : 'Pemain 2';
  ['name-w','lbl-w'].forEach(id => document.getElementById(id).textContent = p1Name);
  ['name-b','lbl-b'].forEach(id => document.getElementById(id).textContent = p2Name);

  const isAI = gameMode === 'hvai';

  // Terapkan class layout sesuai mode — CSS menangani sembunyikan/tampilkan panel
  const body = document.getElementById('app-body');
  body.classList.remove('mode-hvai', 'mode-hvh');
  body.classList.add(isAI ? 'mode-hvai' : 'mode-hvh');

  syncInGameDiff();
  resizeCanvas();
  initHvHTips();
  syncHvHScore();
  newGame();
}

function syncInGameDiff() {
  [1,2,3].forEach(i => document.getElementById('g'+i).classList.toggle('active', i === difficulty));
  const cfg = DIFF_CFG[difficulty];
  document.getElementById('game-diff-desc').textContent = cfg.desc;
  document.getElementById('depth-val').textContent = aiDepth;
  document.getElementById('game-depth-slider').value = aiDepth;

  const abBtn = document.getElementById('btn-toggle-ab');
  abBtn.textContent = useAlphaBeta ? 'ON' : 'OFF';
  abBtn.classList.toggle('on', useAlphaBeta);
  document.getElementById('ab-info').textContent = useAlphaBeta
    ? 'Pemangkasan aktif · lebih efisien'
    : 'Minimax murni · tanpa pemangkasan';
}

// In-game: ganti difficulty (tetap pakai Minimax, hanya depth berubah)
function inGameSetDiff(lv) {
  difficulty = lv; aiDepth = DIFF_CFG[lv].depth; sfx.btn();
  document.getElementById('game-depth-slider').value = aiDepth;
  syncInGameDiff();
}

// In-game: atur depth manual via slider (Fitur 6)
function inGameSetDepth(d) {
  aiDepth = d; sfx.btn();
  document.getElementById('depth-val').textContent = d;
  // Sinkronkan tombol difficulty jika cocok
  [1,2,3].forEach(i => document.getElementById('g'+i).classList.toggle('active', DIFF_CFG[i].depth === d));
}

// Toggle Minimax murni vs Alpha-Beta (Fitur 5)
function toggleAlphaBeta() {
  useAlphaBeta = !useAlphaBeta; sfx.btn();
  syncInGameDiff();
}

function backToMenu() {
  sfx.btn();
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  stopDrawTimer(); stopDrawWait();
  ['scr-win','scr-htp'].forEach(id => document.getElementById(id).classList.remove('show'));
  document.getElementById('scr-menu').classList.add('show');
  ['btn-hvai','btn-hvh'].forEach(id => document.getElementById(id).classList.remove('selected'));
  document.getElementById('menu-diff-section').classList.remove('hidden');
  document.getElementById('menu-hint').style.opacity = '0';
  // Bersihkan class mode dari app-body
  const body = document.getElementById('app-body');
  if (body) body.classList.remove('mode-hvai', 'mode-hvh');
  gameMode = null; gameOver = true;
}

function confirmRestart() { sfx.btn(); restartGame(); }
function restartGame() {
  sfx.btn();
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  document.getElementById('scr-win').classList.remove('show');
  newGame();
}


// ── 6. RENDER CANVAS ─────────────────────────────────────────
// Konversi (row,col) grid 7×7 → koordinat piksel canvas
function gxy(r, c) {
  const S = cvs.width, mg = S * .062, cl = (S - 2*mg) / 6;
  return { x: mg + c*cl, y: mg + r*cl };
}
function nxy(i) { const [r,c] = NODE_POS[i]; return gxy(r,c); }
function pR()   { return cvs.width * .029; }

// Trigger animasi highlight pada node yang baru digerakkan AI (Fitur 10)
function animateAIMove(node) {
  animNode = node;
  if (animTimer) clearTimeout(animTimer);
  // Hapus highlight setelah 1.2 detik
  animTimer = setTimeout(() => { animNode = -1; draw(); }, 1200);
}

function draw() {
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  drawBg(); drawLines(); drawNodes(); drawPieces();
  if (animNode !== -1) drawAnimHighlight(animNode);
}

// Gambar cincin animasi berdenyut pada node AI yang baru bergerak
function drawAnimHighlight(node) {
  const {x, y} = nxy(node), R = pR();
  const t = Date.now() / 300;
  const pulse = 1 + 0.35 * Math.abs(Math.sin(t));
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, R * 1.6 * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,107,53,0.75)';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
  // Re-draw terus selama animasi aktif
  if (animNode !== -1) requestAnimationFrame(draw);
}

function drawBg() {
  const S = cvs.width;
  const g = ctx.createRadialGradient(S/2,S/2,S*.08, S/2,S/2,S*.72);
  g.addColorStop(0,'#261a0a'); g.addColorStop(1,'#0e0904');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(0,0,S,S,10); ctx.fill();
  // Efek serat kayu tipis
  ctx.save(); ctx.globalAlpha = .04;
  for (let i = 0; i < 14; i++) {
    const y = (i/14)*S + Math.sin(i*.9)*8;
    ctx.strokeStyle='#C4893A'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.bezierCurveTo(S*.3,y+10,S*.7,y-8,S,y+4); ctx.stroke();
  }
  ctx.restore();
}

function drawLines() {
  const mset = millNodes(), drawn = new Set();
  for (let i = 0; i < 24; i++) {
    for (const j of ADJ[i]) {
      const key = Math.min(i,j)+','+Math.max(i,j);
      if (drawn.has(key)) continue; drawn.add(key);
      const a = nxy(i), b = nxy(j);
      const isMill = mset.has(i) && mset.has(j) && board[i] !== E && board[i] === board[j];
      ctx.save();
      if (isMill) { ctx.shadowColor='#FFD700'; ctx.shadowBlur=10; ctx.strokeStyle='rgba(255,215,0,.65)'; ctx.lineWidth=2.5; }
      else { ctx.strokeStyle='rgba(196,137,58,.5)'; ctx.lineWidth=1.6; }
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.restore();
    }
  }
}

function drawNodes() {
  const isHuman = turn === W || (gameMode === 'hvh' && turn === B);
  const validTo = (selected !== null && !mustRemove && !gameOver && isHuman) ? validDests(selected) : new Set();
  const canPlace = !mustRemove && !gameOver && selected === null && isHuman && phaseOf(turn) === 'placing';
  for (let i = 0; i < 24; i++) {
    if (board[i] !== E) continue;
    const {x,y} = nxy(i), R = pR();
    let r = R*.3, color = 'rgba(196,137,58,.38)';
    if (canPlace)           { r=R*.42; color='rgba(78,205,196,.52)'; }
    else if (validTo.has(i)){ r=R*.54; color='rgba(78,205,196,.88)'; }
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
  }
}

function drawPieces() {
  const mset = millNodes(), R = pR();
  for (let i = 0; i < 24; i++) {
    if (board[i] === E) continue;
    const {x,y} = nxy(i);
    const isW = board[i]===W, inMl = mset.has(i), isSel = i===selected;
    const canDel = mustRemove && board[i]!==turn && removable(i);
    ctx.save();
    if (isSel)  { ctx.beginPath(); ctx.arc(x,y,R+R*.55,0,Math.PI*2); ctx.strokeStyle='rgba(78,205,196,.75)'; ctx.lineWidth=2; ctx.stroke(); }
    if (canDel) { ctx.beginPath(); ctx.arc(x,y,R+R*.5,0,Math.PI*2); ctx.strokeStyle='rgba(255,107,53,.9)'; ctx.lineWidth=2; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]); }
    if (inMl)   { ctx.shadowColor='#FFD700'; ctx.shadowBlur=18; }
    const gr = ctx.createRadialGradient(x-R*.27,y-R*.33,R*.12, x,y,R);
    if (isW) { gr.addColorStop(0,'#ffffff'); gr.addColorStop(.5,'#EAE0CC'); gr.addColorStop(1,'#9A7040'); }
    else     { gr.addColorStop(0,'#7A5030'); gr.addColorStop(.5,'#2E1A08'); gr.addColorStop(1,'#040201'); }
    ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2); ctx.fillStyle=gr; ctx.fill();
    ctx.strokeStyle=isW?'#B8803A':'#4A2A08'; ctx.lineWidth=1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(x-R*.33,y-R*.33,R*.24,0,Math.PI*2);
    ctx.fillStyle=isW?'rgba(255,255,255,.5)':'rgba(255,255,255,.1)'; ctx.fill();
    ctx.restore();
  }
}


// ── 7. LOGIKA ATURAN PERMAINAN ────────────────────────────────

function phaseOf(player) {
  const h = player===W ? handW : handB;
  if (h > 0) return 'placing';
  return board.filter(v=>v===player).length <= 3 ? 'flying' : 'moving';
}

// Versi dengan state eksplisit (dipakai di Minimax)
function phaseOfState(player, hW_, hB_, brd) {
  const h = player===W ? hW_ : hB_;
  if (h > 0) return 'placing';
  return brd.filter(v=>v===player).length <= 3 ? 'flying' : 'moving';
}

function millNodes() {
  const s = new Set();
  MILLS.forEach(m => { if (m.every(i=>board[i]===W)||m.every(i=>board[i]===B)) m.forEach(i=>s.add(i)); });
  return s;
}

function inMill(i, player, brd=board) {
  return MILLS.some(m => m.includes(i) && m.every(j=>brd[j]===player));
}

// Pion bisa dihapus jika tidak dalam mill, atau semua pion lawan dalam mill
function removable(i, brd=board) {
  const o = brd[i]; if (o===E) return false;
  if (!inMill(i,o,brd)) return true;
  for (let j=0;j<24;j++) if (brd[j]===o && !inMill(j,o,brd)) return false;
  return true;
}

function validDests(from, brd=board, player=turn, hW_=handW, hB_=handB) {
  const s = new Set(), ph = phaseOfState(player,hW_,hB_,brd);
  if (ph==='flying') { for(let j=0;j<24;j++) if(brd[j]===E) s.add(j); }
  else ADJ[from].forEach(j => { if(brd[j]===E) s.add(j); });
  return s;
}

function makesMill(player, node, brd) {
  return MILLS.some(m => m.includes(node) && m.every(j=>brd[j]===player));
}

function hasLost(player, brd=board, hW_=handW, hB_=handB) {
  const h = player===W ? hW_ : hB_;
  if (h > 0) return false;
  const cnt = brd.filter(v=>v===player).length;
  if (cnt <= 2) return true;
  if (cnt === 3) return false;
  for (let i=0;i<24;i++) { if(brd[i]!==player) continue; if(ADJ[i].some(j=>brd[j]===E)) return false; }
  return true;
}


// ── 8. INPUT HANDLER ─────────────────────────────────────────
cvs.addEventListener('click', handleInput);
cvs.addEventListener('touchstart', e => {
  e.preventDefault();
  const rect=cvs.getBoundingClientRect(), t=e.touches[0];
  handleInput({ offsetX:(t.clientX-rect.left)*(cvs.width/rect.width), offsetY:(t.clientY-rect.top)*(cvs.height/rect.height) });
}, {passive:false});

function handleInput(e) {
  if (gameOver) return;
  if (gameMode==='hvai' && turn===B) return;
  const node = pickNode(e.offsetX, e.offsetY);
  if (node === null) return;

  if (mustRemove) {
    const enemy = turn===W?B:W;
    if (board[node]!==enemy) { sfx.error(); setStatus('⚠ Pilih pion lawan yang bisa dihapus!'); return; }
    if (!removable(node))    { sfx.error(); setStatus('⚠ Pion dalam mill! Pilih pion lain.'); return; }
    doRemove(node, turn); return;
  }

  const ph = phaseOf(turn);
  if (ph === 'placing') {
    if (board[node]!==E) { sfx.error(); setStatus('Titik itu sudah terisi!'); return; }
    doPlace(turn, node);
  } else {
    if (selected===null) {
      if (board[node]!==turn) { sfx.error(); setStatus('Pilih pion kamu!'); return; }
      selected=node; sfx.select(); setStatus('Klik titik tujuan yang menyala.'); draw();
    } else if (node===selected) {
      selected=null; draw();
    } else if (board[node]===turn) {
      selected=node; sfx.select(); draw();
    } else {
      if (!validDests(selected).has(node)) { sfx.error(); setStatus('⚠ Gerakan tidak valid!'); return; }
      doMove(turn, selected, node); selected=null;
    }
  }
}

function pickNode(mx, my) {
  let best=null, bestD=Infinity;
  for (let i=0;i<24;i++) { const{x,y}=nxy(i),d=Math.hypot(mx-x,my-y); if(d<bestD){bestD=d;best=i;} }
  const S=cvs.width, mg=S*.062, cl=(S-2*mg)/6;
  return bestD < cl*.44 ? best : null;
}


// ── 9. AKSI DI PAPAN ─────────────────────────────────────────

// Catat satu baris ke Riwayat Langkah (Fitur tambahan: histori pertandingan)
let logCount = 0;
function logMove(player, html) {
  const box = document.getElementById('move-log');
  const boxHvH = document.getElementById('move-log-hvh');
  if (!box) return;
  if (logCount === 0) {
    box.innerHTML = '';
    if (boxHvH) boxHvH.innerHTML = '';
  }
  logCount++;
  const cls = player === W ? 'lg-w' : 'lg-b';
  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = `<span class="${cls}">#${logCount}</span><span>${html}</span>`;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  if (boxHvH) {
    const row2 = row.cloneNode(true);
    boxHvH.appendChild(row2);
    boxHvH.scrollTop = boxHvH.scrollHeight;
    while (boxHvH.children.length > 40) boxHvH.removeChild(boxHvH.firstChild);
  }
  while (box.children.length > 40) box.removeChild(box.firstChild);
}
function resetLog() {
  logCount = 0;
  const box = document.getElementById('move-log');
  if (box) box.innerHTML = '<div class="log-empty">Belum ada langkah.</div>';
  const boxHvH = document.getElementById('move-log-hvh');
  if (boxHvH) boxHvH.innerHTML = '<div class="log-empty">Belum ada langkah.</div>';
}

function doPlace(player, node) {
  board[node]=player;
  if (player===W){handW--;onBrdW++;}else{handB--;onBrdB++;}
  sfx.place();
  logMove(player, `${pn(player)} taruh di titik ${node+1}`);
  if (makesMill(player,node,board)) { afterMill(player); return; }
  afterAction(player);
}

function doMove(player, from, to) {
  board[to]=player; board[from]=E;
  sfx.move();
  logMove(player, `${pn(player)} pindah ${from+1} → ${to+1}`);
  if (makesMill(player,to,board)) { afterMill(player); return; }
  afterAction(player);
}

function doRemove(node, player) {
  const owner=board[node]; board[node]=E;
  if (owner===W) onBrdW--; else onBrdB--;
  mustRemove=false; moveCount=0; posHistory=[];
  logMove(player, `${pn(player)} hapus pion ${pn(owner)} di ${node+1} 🔥`);
  sfx.remove(); updateUI(); draw();
  if (hasLost(owner)) { endGame(player); return; }
  nextTurn();
}

function afterAction(player) {
  updateUI(); draw();
  const enemy=player===W?B:W;
  if (hasLost(enemy)) { endGame(player); return; }
  moveCount++;
  const posKey = board.join(',')+turn;
  posHistory.push(posKey);
  if (moveCount>=60 || posHistory.filter(p=>p===posKey).length>=3) { drawGame(); return; }
  checkDrawTimer(); // cek apakah kondisi timer seri terpenuhi
  nextTurn();
}

function afterMill(player) {
  mustRemove=true; sfx.mill();
  setStatus(`<span class="hl">🔥 MILL! Hapus 1 pion ${pn(player===W?B:W)}!</span>`);
  updateUI(); draw();
  // AI eksekusi penghapusan otomatis setelah mill
  if (gameMode==='hvai' && player===B) {
    aiTimer=setTimeout(()=>{
      const ri = (aiDepth<=1) ? randomRemove(W) : bestRemove(W,board);
      if (ri!==-1) doRemove(ri,B); else { mustRemove=false; nextTurn(); }
    }, 600);
  }
}

function randomRemove(enemy) {
  const rm=[]; for(let i=0;i<24;i++) if(board[i]===enemy&&removable(i,board)) rm.push(i);
  return rm.length>0 ? rm[Math.floor(Math.random()*rm.length)] : -1;
}

function pn(p) { return p===W ? p1Name : p2Name; }

// ── Timer Seri (dua fase) ────────────────────────────────────
// Fase 1: kondisi 3v3 → tunggu 2 menit (silent, tidak tampil)
// Fase 2: setelah 2 menit → tampilkan countdown 30 detik + suara

function checkDrawTimer() {
  const wPieces  = board.filter(v => v === W).length;
  const bPieces  = board.filter(v => v === B).length;
  const cond3v3  = handW===0 && handB===0 && wPieces===3 && bPieces===3;

  if (cond3v3) {
    // Langsung mulai countdown 90 detik jika belum berjalan
    if (!drawTimerActive) startDrawTimer();
  } else {
    // Kondisi sudah tidak 3v3 → batalkan timer
    stopDrawTimer();
    stopDrawWait();
  }
}

// Fase 1: tunggu 2 menit dalam diam sebelum tampilkan countdown
function startDrawWait() {
  if (drawWaitActive) return;
  drawWaitActive = true;
  drawWaitVal = DRAW_WAIT_SECS;
  drawTimerInterval = setInterval(() => {
    drawWaitVal--;
    if (drawWaitVal <= 0) {
      stopDrawWait();
      startDrawTimer(); // masuk fase countdown
    }
  }, 1000);
}

function stopDrawWait() {
  if (!drawWaitActive) return;
  drawWaitActive = false;
  clearInterval(drawTimerInterval);
  drawTimerInterval = null;
}

// Fase 2: countdown 30 detik + suara tick
function startDrawTimer() {
  if (drawTimerActive) return;
  drawTimerActive = true;
  drawTimerVal = DRAW_TIMER_SECS;
  document.getElementById('draw-timer-box').style.display = '';
  updateDrawTimerUI();

  drawTimerInterval = setInterval(() => {
    drawTimerVal--;
    updateDrawTimerUI();
    // Suara tick tiap detik (semakin cepat saat < 10 detik)
    playTimerTick(drawTimerVal);
    if (drawTimerVal <= 0) {
      stopDrawTimer();
      drawGame(); // seri!
    }
  }, 1000);
}

function stopDrawTimer() {
  if (!drawTimerActive) return;
  drawTimerActive = false;
  clearInterval(drawTimerInterval);
  drawTimerInterval = null;
  document.getElementById('draw-timer-box').style.display = 'none';
}

// Suara tick countdown — frekuensi & volume meningkat saat hampir habis
function playTimerTick(remaining) {
  if (muted) return;
  try {
    const ac = getAC();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    // Semakin sedikit sisa waktu → nada semakin tinggi
    const isWarn = remaining <= 10;
    o.type = 'sine';
    o.frequency.value = isWarn ? 880 : 660;
    const t = ac.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(isWarn ? 0.25 : 0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (isWarn ? 0.12 : 0.08));
    o.start(t); o.stop(t + 0.15);
  } catch(e) {}
}

function updateDrawTimerUI() {
  const el    = document.getElementById('draw-timer-num');
  const bar   = document.getElementById('draw-timer-bar');
  if (!el || !bar) return;
  el.textContent = drawTimerVal;
  bar.style.width = (drawTimerVal / DRAW_TIMER_SECS * 100) + '%';
  // Warna kuning saat ≤ 10 detik tersisa
  const warn = drawTimerVal <= 10;
  el.classList.toggle('warn', warn);
  bar.classList.toggle('warn', warn);
}

function nextTurn() {
  turn=turn===W?B:W; selected=null;
  rotateTip(); updateUI();
  const isHuman = turn===W || (gameMode==='hvh'&&turn===B);
  if (isHuman) {
    const ph=phaseOf(turn);
    setStatus(ph==='placing'
      ? `Giliran ${pn(turn)}. Tempatkan pion ${turn===W?'putih':'hitam'}.`
      : `Giliran ${pn(turn)}. Pilih pion, lalu klik tujuan.`);
    draw();
  } else {
    document.getElementById('ai-thinking').classList.add('show');
    setStatus('<span class="thinking anim-pulse">AI sedang berpikir…</span>');
    draw();
    aiTimer=setTimeout(()=>{
      document.getElementById('ai-thinking').classList.remove('show');
      aiTurn();
    }, 1600+Math.random()*700);
  }
}

function drawGame() {
  gameOver=true; totalG++;
  document.getElementById('game-count').textContent=`${totalG} permainan selesai`;
  syncHvHScore();
  sfx.btn();
  document.getElementById('win-icon').textContent='🤝';
  document.getElementById('win-title').textContent='Permainan Seri!';
  document.getElementById('win-sub').textContent='Posisi berulang. Tidak ada pemenang.';
  document.getElementById('win-score').innerHTML=winScoreHTML();
  draw();
  setTimeout(()=>document.getElementById('scr-win').classList.add('show'),900);
}

function endGame(winner) {
  gameOver=true;
  const isW=winner===W;
  if(isW) scoreH++; else scoreA++;
  totalG++;
  document.getElementById('sh').textContent=scoreH;
  document.getElementById('sa').textContent=scoreA;
  document.getElementById('game-count').textContent=`${totalG} permainan selesai`;
  syncHvHScore();
  isW?sfx.win():sfx.lose();
  document.getElementById('win-icon').textContent=isW?'🏆':'🤖';
  document.getElementById('win-title').textContent=`${pn(winner)} Menang!`;
  document.getElementById('win-sub').textContent=gameMode==='hvai'
    ?(isW?'Selamat! Anda berhasil mengalahkan AI! 🎉':'AI berhasil mengalahkan Anda. Coba lagi!')
    :`Selamat ${pn(winner)}!`;
  document.getElementById('win-score').innerHTML=winScoreHTML();
  draw();
  setTimeout(()=>document.getElementById('scr-win').classList.add('show'),900);
}

function winScoreHTML() {
  return `<span style='color:var(--text)'>${p1Name}</span> ` +
         `<span style='font-size:1.3rem'>${scoreH}</span> ` +
         `<span style='color:var(--dim);margin:0 .3rem'>—</span> ` +
         `<span style='font-size:1.3rem'>${scoreA}</span> ` +
         `<span style='color:var(--text)'>${p2Name}</span>`;
}


// ── 10. ALGORITMA AI ─────────────────────────────────────────
// Minimax + Alpha-Beta Pruning — implementasi mandiri, bukan library.
// Referensi pseudocode: Russell & Norvig 2020, hal. 150-152.

// Fungsi evaluasi: nilai positif = AI (BLACK) unggul, negatif = Human unggul
function evaluate(brd, hW_, hB_) {
  let s = 0;
  const ai  = brd.filter(v=>v===B).length;
  const hum = brd.filter(v=>v===W).length;

  if (hW_===0 && hum<=2) return  50000;
  if (hB_===0 && ai<=2)  return -50000;

  s += (ai+hB_ - hum-hW_) * 20; // selisih pion

  MILLS.forEach(m => {
    const ac=m.filter(i=>brd[i]===B).length, hc=m.filter(i=>brd[i]===W).length, ec=m.filter(i=>brd[i]===E).length;
    if(ac===3) s+=500; if(hc===3) s-=500;   // mill terbentuk
    if(ac===2&&ec===1) s+=50; if(hc===2&&ec===1) s-=50; // hampir mill
    if(ac===1&&ec===2) s+=5;  if(hc===1&&ec===2) s-=5;  // satu pion
  });

  // Mobilitas: lebih banyak pilihan gerak = lebih unggul
  if(hB_===0&&ai>3)  {let m=0;for(let i=0;i<24;i++)if(brd[i]===B)m+=ADJ[i].filter(j=>brd[j]===E).length;s+=m*3;}
  if(hW_===0&&hum>3) {let m=0;for(let i=0;i<24;i++)if(brd[i]===W)m+=ADJ[i].filter(j=>brd[j]===E).length;s-=m*3;}

  return s;
}

function genMoves(player, brd, hW_, hB_) {
  const moves=[], ph=phaseOfState(player,hW_,hB_,brd);
  if (ph==='placing') { for(let i=0;i<24;i++) if(brd[i]===E) moves.push({t:'p',to:i}); }
  else {
    const fly=ph==='flying';
    for(let i=0;i<24;i++) {
      if(brd[i]!==player) continue;
      const tg=fly?Array.from({length:24},(_,j)=>j).filter(j=>brd[j]===E):ADJ[i].filter(j=>brd[j]===E);
      tg.forEach(j=>moves.push({t:'m',from:i,to:j}));
    }
  }
  return moves;
}

function applyMv(mv, player, brd, hW_, hB_) {
  const b2=[...brd];
  if(mv.t==='p'){b2[mv.to]=player;return{b2,hw2:player===W?hW_-1:hW_,hb2:player===B?hB_-1:hB_};}
  b2[mv.to]=player; b2[mv.from]=E; return{b2,hw2:hW_,hb2:hB_};
}
function applyRm(idx, brd) { const b2=[...brd]; b2[idx]=E; return b2; }

// Pilih pion mana yang paling berbahaya untuk dihapus dari lawan
function bestRemove(enemy, brd) {
  let bi=-1, bs=-Infinity;
  for(let i=0;i<24;i++){
    if(brd[i]!==enemy||!removable(i,brd)) continue;
    let s=0; MILLS.forEach(m=>{if(!m.includes(i))return;const c=m.filter(j=>brd[j]===enemy).length;s+=c*c;});
    if(s>bs){bs=s;bi=i;}
  }
  if(bi===-1) for(let i=0;i<24;i++) if(brd[i]===enemy&&removable(i,brd)) return i;
  return bi;
}

// ── Minimax dengan Alpha-Beta Pruning ──
// isMax=true → giliran AI (maximizer), false → Human (minimizer)
// alpha = nilai terbaik sudah ditemukan MAX, beta = nilai terbaik MIN
// Jika useAlphaBeta=false, pruning di-nonaktifkan → Minimax murni
function minimax(brd, hW_, hB_, depth, alpha, beta, isMax) {
  if (useAlphaBeta) ncAlphaBeta++; else ncMinimax++;

  if (depth===0) return evaluate(brd,hW_,hB_);
  const pl=isMax?B:W, en=isMax?W:B;
  if(hasLost(en,brd,hW_,hB_)) return  10000+depth;
  if(hasLost(pl,brd,hW_,hB_)) return -10000-depth;
  const moves=genMoves(pl,brd,hW_,hB_);
  if(!moves.length) return isMax?-10000-depth:10000+depth;

  if(isMax){
    let best=-Infinity;
    for(const mv of moves){
      const{b2,hw2,hb2}=applyMv(mv,pl,brd,hW_,hB_);
      let eb=b2;
      if(makesMill(pl,mv.to,b2)){const ri=bestRemove(en,b2);if(ri!==-1)eb=applyRm(ri,b2);}
      const val=minimax(eb,hw2,hb2,depth-1,alpha,beta,false);
      best=Math.max(best,val); alpha=Math.max(alpha,val);
      if(useAlphaBeta && beta<=alpha) break; // alpha cut-off
    }
    return best;
  } else {
    let best=Infinity;
    for(const mv of moves){
      const{b2,hw2,hb2}=applyMv(mv,pl,brd,hW_,hB_);
      let eb=b2;
      if(makesMill(pl,mv.to,b2)){const ri=bestRemove(en,b2);if(ri!==-1)eb=applyRm(ri,b2);}
      const val=minimax(eb,hw2,hb2,depth-1,alpha,beta,true);
      best=Math.min(best,val); beta=Math.min(beta,val);
      if(useAlphaBeta && beta<=alpha) break; // beta cut-off
    }
    return best;
  }
}

// Jalankan giliran AI: pilih gerakan terbaik dari Minimax
function aiTurn() {
  if (gameOver||turn!==B) return;
  const moves=genMoves(B,board,handW,handB);
  if(!moves.length){endGame(W);return;}

  ncAlphaBeta=0; ncMinimax=0;
  let bm=moves[0];

  if(aiDepth<=1){
    // Mudah: lebih banyak unsur acak, tapi tetap ambil mill kalau ada
    const millMoves=moves.filter(mv=>{const{b2}=applyMv(mv,B,board,handW,handB);return makesMill(B,mv.to,b2);});
    bm=(millMoves.length>0&&Math.random()<.4)
      ?millMoves[Math.floor(Math.random()*millMoves.length)]
      :moves[Math.floor(Math.random()*moves.length)];
    // Tetap hitung node untuk counter (jalankan minimax depth 1 utk semua move)
    for(const mv of moves){
      const{b2,hw2,hb2}=applyMv(mv,B,board,handW,handB);
      minimax(b2,hw2,hb2,0,-Infinity,Infinity,false);
    }
  } else {
    // Sedang/Sulit: cari gerakan terbaik dengan Minimax
    let bs=-Infinity;
    for(const mv of moves){
      const{b2,hw2,hb2}=applyMv(mv,B,board,handW,handB); let eb=b2;
      if(makesMill(B,mv.to,b2)){const ri=bestRemove(W,b2);if(ri!==-1)eb=applyRm(ri,b2);}
      const score=minimax(eb,hw2,hb2,aiDepth-1,-Infinity,Infinity,false);
      if(score>bs){bs=score;bm=mv;}
    }
    // Jika Alpha-Beta aktif: jalankan ulang Minimax MURNI di depth yang sama
    // (tanpa pruning) agar ncMinimax vs ncAlphaBeta bisa dibandingkan apa adanya
    if(useAlphaBeta){
      const savedAB=useAlphaBeta;
      useAlphaBeta=false; // sementara nonaktif untuk hitung node murni
      for(const mv of moves){
        const{b2,hw2,hb2}=applyMv(mv,B,board,handW,handB);let eb=b2;
        if(makesMill(B,mv.to,b2)){const ri=bestRemove(W,b2);if(ri!==-1)eb=applyRm(ri,b2);}
        minimax(eb,hw2,hb2,aiDepth-1,-Infinity,Infinity,false);
      }
      useAlphaBeta=savedAB;
    }
  }

  const movedTo = bm.to;
  if(bm.t==='p') doPlace(B,bm.to); else doMove(B,bm.from,bm.to);
  animateAIMove(movedTo);  // Fitur 10: animasi highlight node AI
  updateNodeCounter();
  if(gameMode==='hvai') buildGameTree();
}

// Update tampilan counter node setelah AI bergerak
function updateNodeCounter(){
  if(gameMode!=='hvai') return;
  const mm=ncMinimax, ab=useAlphaBeta?ncAlphaBeta:0;
  const actualAB=useAlphaBeta?ab:mm;
  const pruned=Math.max(0,mm-actualAB);
  const pct=mm>0?Math.round(pruned/mm*100):0;
  document.getElementById('nc-mm').textContent=mm.toLocaleString('id-ID');
  document.getElementById('nc-ab').textContent=(useAlphaBeta?actualAB:mm).toLocaleString('id-ID');
  document.getElementById('nc-pruned').textContent=pruned.toLocaleString('id-ID')+' ('+pct+'%)';
  document.getElementById('nc-bar-mm').style.width='100%';
  document.getElementById('nc-bar-ab').style.width=(mm>0?Math.round(actualAB/mm*100):100)+'%';
  document.getElementById('nc-info').textContent=
    `Depth ${aiDepth} · ${useAlphaBeta?'Alpha-Beta':'Minimax murni'} · Dipangkas ${pct}%`;
}

// Reset counter node ke nilai 0 (tampil sejak awal game HvAI)
function resetNodeCounter(){
  document.getElementById('nc-mm').textContent='0';
  document.getElementById('nc-ab').textContent='0';
  document.getElementById('nc-pruned').textContent='0 (0%)';
  document.getElementById('nc-bar-mm').style.width='100%';
  document.getElementById('nc-bar-ab').style.width='0%';
  document.getElementById('nc-info').textContent='Menunggu giliran AI…';
}


// ── 11. VISUALISASI GAME TREE (Fitur 3) ──────────────────────
// Membangun SVG game tree 3 level dari posisi papan saat ini.
// Level 0 = root (posisi sekarang, giliran AI)
// Level 1 = gerakan AI (MAX) — sampai 5 node
// Level 2 = gerakan Human (MIN) — sampai 3 per node
// Level 3 = leaf — nilai evaluasi

function buildGameTree(){
  const container=document.getElementById('tree-container');
  if(!container) return;

  const W_SVG=640, H_SVG=108;
  const rootMoves=genMoves(B,board,handW,handB).slice(0,5);
  if(!rootMoves.length){ container.innerHTML='<div class="tree-placeholder">Tidak ada gerakan.</div>'; return; }

  const rootVal=evaluate(board,handW,handB);
  let bestVal=-Infinity;

  // Kumpulkan data tree (level 1 & 2)
  const children=rootMoves.map(mv=>{
    const{b2,hw2,hb2}=applyMv(mv,B,board,handW,handB); let eb=b2,ewh=hw2,ewb=hb2;
    if(makesMill(B,mv.to,b2)){const ri=bestRemove(W,b2);if(ri!==-1)eb=applyRm(ri,b2);}
    const v1=evaluate(eb,ewh,ewb);
    if(v1>bestVal) bestVal=v1;
    const grandMoves=genMoves(W,eb,ewh,ewb).slice(0,3);
    const grands=grandMoves.map(mv2=>{
      const r2=applyMv(mv2,W,eb,ewh,ewb);
      return{val:evaluate(r2.b2,r2.hw2,r2.hb2)};
    });
    return{val:v1, isBest:false, grands};
  });
  // Tandai gerakan terbaik AI
  children.forEach(c=>{ if(c.val===bestVal) c.isBest=true; });

  // ── Layout SVG ──
  const marginX=30, rootX=W_SVG/2, rootY=14, nodeR=11;
  const level1Y=44, level2Y=88;
  const childSpacing=W_SVG/(children.length+1);

  let edges='', nodes='';

  // Root node
  nodes+=svgCircle(rootX,rootY,nodeR,'#E8A020',rootVal,'MAX');

  children.forEach((child,ci)=>{
    const cx=childSpacing*(ci+1);
    const col=child.isBest?'#FFD700':child.val>0?'#FF6B35':'#aaa';
    edges+=svgLine(rootX,rootY+nodeR,cx,level1Y-nodeR,'rgba(196,137,58,.5)');
    nodes+=svgCircle(cx,level1Y,nodeR,col,child.val,'MIN');

    // Level 2 (cucu)
    const gSpacing=childSpacing/(child.grands.length+1);
    child.grands.forEach((g,gi)=>{
      const gx=cx-childSpacing/2+gSpacing*(gi+1);
      const gc=g.val>0?'#4ECDC4':'#6a8a80';
      edges+=svgLine(cx,level1Y+nodeR,gx,level2Y-nodeR*.8,'rgba(78,205,196,.35)');
      nodes+=svgCircle(gx,level2Y,nodeR*.75,gc,g.val,'');
    });
  });

  // Label level
  const lbls=
    `<text x="4" y="18" fill="#E8A020" font-size="8" font-family="monospace" opacity=".8">MAX</text>`+
    `<text x="4" y="50" fill="#FF6B35" font-size="8" font-family="monospace" opacity=".8">MIN</text>`+
    `<text x="4" y="92" fill="#4ECDC4" font-size="8" font-family="monospace" opacity=".8">Leaf</text>`;

  container.innerHTML=`<svg viewBox="0 0 ${W_SVG} ${H_SVG}" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;height:100%;background:#080503;border-radius:6px">${lbls}${edges}${nodes}</svg>`;
}

function svgCircle(x,y,r,color,val,lbl){
  return `<g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${color}22" stroke="${color}" stroke-width="1.2"/>
    <text x="${x}" y="${y+3.5}" text-anchor="middle" fill="${color}" font-size="7.5" font-family="monospace" font-weight="bold">${val}</text>
  </g>`;
}
function svgLine(x1,y1,x2,y2,color){
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1"/>`;
}


// ── 12. UI & STATE HELPERS ────────────────────────────────────

function setStatus(html){ document.getElementById('status-msg').innerHTML=html; }

function updateUI(){
  document.getElementById('hw').textContent=handW;
  document.getElementById('hb').textContent=handB;
  document.getElementById('card-w').classList.toggle('active',turn===W&&!gameOver);
  document.getElementById('card-b').classList.toggle('active',turn===B&&!gameOver);
  document.getElementById('ob-w').textContent=board.filter(v=>v===W).length;
  document.getElementById('ob-b').textContent=board.filter(v=>v===B).length;

  const banner=document.getElementById('turn-banner');
  if(turn===W){ banner.textContent=gameMode==='hvai'?'✦ GILIRAN ANDA ✦':`✦ GILIRAN ${p1Name.toUpperCase()} ✦`; banner.className='turn-banner human'; }
  else if(gameMode==='hvh'){ banner.textContent=`✦ GILIRAN ${p2Name.toUpperCase()} ✦`; banner.className='turn-banner p2'; }
  else{ banner.textContent='✦ GILIRAN AI ✦'; banner.className='turn-banner ai'; }

  const ph=phaseOf(turn), bdg=document.getElementById('phase-badge');
  bdg.className='badge '+ph;
  bdg.textContent={placing:'Penempatan',moving:'Pergerakan',flying:'Bebas Gerak'}[ph];
}

// Rotate tips — dipanggil setiap giliran berganti (HvAI maupun HvH)
function rotateTip(){
  const tip = TIPS[tipIdx++ % TIPS.length];
  const el = document.getElementById('tip-text');
  if (el) el.textContent = tip;
  const elHvH = document.getElementById('tip-text-hvh');
  if (elHvH) elHvH.textContent = tip;
}

// Sinkronisasi skor ke kotak HvH di panel kanan
function syncHvHScore(){
  const r=document.getElementById('sh-r'), s=document.getElementById('sa-r');
  const gc=document.getElementById('game-count-r');
  if(r) r.textContent=scoreH;
  if(s) s.textContent=scoreA;
  if(gc) gc.textContent=totalG?`${totalG} permainan selesai`:'Belum ada permainan selesai';
  const lw=document.getElementById('lbl-w-r'), lb=document.getElementById('lbl-b-r');
  if(lw) lw.textContent=p1Name;
  if(lb) lb.textContent=p2Name;
}

// initHvHTips tidak dipakai lagi — tips dirotasi via rotateTip() tiap giliran
function initHvHTips(){ /* legacy, tidak dipakai */ }

function newGame(){
  board=new Array(24).fill(E);
  turn=W; handW=9; handB=9; onBrdW=0; onBrdB=0;
  selected=null; mustRemove=false; gameOver=false;
  moveCount=0; posHistory=[];
  ncMinimax=0; ncAlphaBeta=0; resetLog();
  animNode=-1; if(animTimer){clearTimeout(animTimer);animTimer=null;}
  stopDrawTimer(); stopDrawWait();
  drawTimerActive=false; drawWaitActive=false;
  drawTimerVal=DRAW_TIMER_SECS; drawWaitVal=DRAW_WAIT_SECS;
  document.getElementById('draw-timer-box').style.display='none';
  document.getElementById('ai-thinking').classList.remove('show');
  resetNodeCounter();
  const tc=document.getElementById('tree-container');
  if(tc) tc.innerHTML='<div class="tree-placeholder">Tree muncul setelah AI bergerak pertama kali.</div>';
  tipIdx = 0; rotateTip(); updateUI();
  setStatus(`Giliran ${p1Name}. Tempatkan pion putih.`);
  draw();
}


// ── INIT ─────────────────────────────────────────────────────
// Jalankan setelah layout DOM stabil agar offsetHeight terukur dengan benar
board = new Array(24).fill(E);
requestAnimationFrame(() => {
  resizeCanvas();
  draw();
});
