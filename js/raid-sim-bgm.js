// 보스 레이드 시뮬레이터 BGM · 효과음 (발표 화면 전용)
// 음원 파일 없이 Web Audio 로 직접 연주하는 8비트(칩튠) 곡입니다. 곡은 모두 이 파일에서 새로 쓴 것이라 저작권 걱정이 없습니다.
// 브라우저 정책상 처음 한 번은 사람이 버튼을 눌러 toggle() 해야 소리가 납니다.
//
// 악보 표기: 한 칸 = 8분음표. "C5" 음 · "-" 앞 음을 이어서 · "." 쉼. 드럼: k 킥 · s 스네어 · h 하이햇 · "." 쉼
(function (root) {
  "use strict";
  const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  const hz = (t, shift) => { const m = /^([A-G]#?)(\d)$/.exec(t); return m ? 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69 + (shift || 0)) / 12) : 0; };
  const seq = (s) => s.trim().split(/\s+/).filter((x) => x !== "|");
  const rep = (s, n) => Array(n).fill(s).join(" ");

  const TRACKS = {
    // 대기 · 캐릭터 만들기 · 공유 · 규칙: 밝고 가벼운 C장조
    lobby: { bpm: 116, gain: 0.8,
      lead: seq(`E5 - G5 - C6 - G5 - | A5 - G5 - E5 - D5 - | F5 - A5 - D6 - A5 - | G5 - F5 - E5 - D5 -
                 E5 - G5 - C6 - G5 - | A5 - C6 - D6 - E6 - | D6 - B5 - G5 - B5 - | C6 - - - . . . .`), leadShift: -12,
      bass: seq(`C3 . C3 . G2 . G2 . | A2 . A2 . E2 . E2 . | F2 . F2 . C3 . C3 . | G2 . G2 . D3 . D3 .
                 C3 . C3 . G2 . G2 . | A2 . A2 . E2 . E2 . | F2 . F2 . G2 . G2 . | C3 . G2 . C3 - - .`),
      drum: seq(rep("k . h . s . h .", 7) + " k . h . s s s .") },
    // 보스 회의: 긴장감 있는 A단조 아르페지오
    meeting: { bpm: 138, gain: 0.75,
      lead: seq(`A4 C5 E5 C5 A4 C5 E5 C5 | G4 B4 D5 B4 G4 B4 D5 B4 | F4 A4 C5 A4 F4 A4 C5 A4 | E4 G#4 B4 G#4 E4 G#4 B4 E5`),
      bass: seq(`A2 - . A2 A2 - . A2 | G2 - . G2 G2 - . G2 | F2 - . F2 F2 - . F2 | E2 - . E2 E2 - . E2`),
      drum: seq(rep("k . h k s . h .", 3) + " k . h k s s s s") },
    // 마감 뒤 기다리는 동안: 베이스와 하이햇만
    wait: { bpm: 120, gain: 0.7,
      lead: seq(rep(".", 32)),
      bass: seq(`A2 . . A2 . . A2 . | G2 . . G2 . . G2 . | F2 . . F2 . . F2 . | E2 . . E2 . . B2 .`),
      drum: seq(rep("k . h . h . h .", 4)) },
    // 주사위 굴리기: 스네어 연타와 올라가는 음
    dice: { bpm: 168, gain: 0.75,
      lead: seq(`C5 D5 E5 F5 G5 A5 B5 C6 | D6 C6 B5 A5 G5 F5 E5 D5`), leadShift: -12,
      bass: seq(`C3 C3 C3 C3 D3 D3 D3 D3 | E3 E3 E3 E3 G3 G3 G3 G3`),
      drum: seq(rep("s s s s s s s s", 2)) },
    // 결과를 본 뒤: 조용한 C장조
    calm: { bpm: 96, gain: 0.55,
      lead: seq(`E5 - - G5 - - C6 - | B5 - - G5 - - D5 - | C5 - - E5 - - A5 - | G5 - - - . . . .`), leadShift: -12,
      bass: seq(`C3 - - - G2 - - - | G2 - - - D3 - - - | A2 - - - E2 - - - | F2 - - - G2 - - -`),
      drum: seq(rep("k . . . h . . .", 4)) },
    // 최종 순위: 승리 팡파르
    victory: { bpm: 126, gain: 0.85,
      lead: seq(`C5 - E5 G5 C6 - G5 - | A5 - F5 A5 C6 - A5 - | G5 - E5 G5 B5 - D6 - | C6 - - - G5 - C6 -`),
      bass: seq(`C3 . C3 . E3 . G3 . | F2 . F2 . A2 . C3 . | G2 . G2 . B2 . D3 . | C3 . G2 . C3 - - .`),
      drum: seq(rep("k . h . s . h .", 3) + " k k s s k k s s") },
  };

  let ctx = null, master = null, noise = null;
  let enabled = false, want = null, cur = null, step = 0, next = 0, timer = null;

  function setup() {
    if (ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.14; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(type, f, t, dur, vol, slideTo) {
    if (!f) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function hiss(t, dur, vol, freq, kind) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = kind; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }
  const drum = (k, t) => k === "k" ? tone("sine", 150, t, 0.16, 0.9, 40) : k === "s" ? hiss(t, 0.12, 0.45, 1800, "bandpass") : k === "h" ? hiss(t, 0.04, 0.25, 7000, "highpass") : null;
  const holdLen = (arr, i) => { let n = 1; while (arr[(i + n) % arr.length] === "-" && n < arr.length) n++; return n; };

  function scheduleStep(tr, i, t, dur) {
    const L = tr.lead[i % tr.lead.length], B = tr.bass[i % tr.bass.length], D = tr.drum[i % tr.drum.length];
    if (L && L !== "-" && L !== ".") tone("square", hz(L, tr.leadShift), t, dur * holdLen(tr.lead, i % tr.lead.length) * 0.9, 0.22 * tr.gain);
    if (B && B !== "-" && B !== ".") tone("triangle", hz(B), t, dur * holdLen(tr.bass, i % tr.bass.length) * 0.95, 0.5 * tr.gain);
    drum(D, t);
  }
  function tick() {
    if (!ctx || !enabled || !cur) return;
    const tr = TRACKS[cur], dur = 30 / tr.bpm;
    while (next < ctx.currentTime + 0.15) { scheduleStep(tr, step, next, dur); step++; next += dur; }
  }
  function start(name) {
    cur = name; step = 0;
    if (ctx) next = ctx.currentTime + 0.06;
  }

  const api = {
    get enabled() { return enabled; },
    get track() { return enabled ? cur : null; },   // 지금 연주 중인 곡 (확인용)
    // 버튼을 눌렀을 때 (사용자 동작 안에서 불러야 소리가 남)
    toggle() {
      setup();
      if (!ctx) return false;
      enabled = !enabled;
      if (enabled) { ctx.resume(); if (want) start(want); if (!timer) timer = setInterval(tick, 25); }
      else { cur = null; master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05); setTimeout(() => { if (!enabled && master) master.gain.value = 0.14; }, 300); }
      return enabled;
    },
    // 지금 단계에 맞는 곡 (같은 곡이면 이어서)
    setTrack(name) {
      if (!TRACKS[name] || want === name) return;
      want = name;
      if (enabled && ctx) start(name);
    },
    // 효과음: hit(타격) · ko(격파) · fail(실패). delay 초 뒤에
    sfx(name, delay) {
      if (!enabled || !ctx) return;
      const t = ctx.currentTime + (delay || 0);
      if (name === "hit") { hiss(t, 0.09, 0.6, 1200, "lowpass"); tone("square", 220, t, 0.09, 0.25, 70); }
      else if (name === "ko") { [523, 659, 784, 1047].forEach((f, i) => tone("square", f, t + i * 0.08, 0.16, 0.22)); tone("triangle", 131, t, 0.5, 0.5); }
      else if (name === "fail") { [392, 330, 262].forEach((f, i) => tone("square", f, t + i * 0.14, 0.2, 0.18)); }
    },
  };
  root.RaidSimBgm = api;
})(typeof window !== "undefined" ? window : globalThis);
