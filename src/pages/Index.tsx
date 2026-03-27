import { useState, useEffect, useCallback, useRef } from "react";

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Screen = "menu" | "game" | "settings" | "shop" | "lobby";
type Direction = "up" | "down" | "left" | "right";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const MAP_COLS = 20;
const MAP_ROWS = 15;
const MAX_FLOOR = 8;
const MONSTER_TIMER_MS = 500;       // monster ticks every 500ms, 1 step per tick
const MONSTER_SPAWN_SECS = 15;      // seconds before monster appears
const ANIM_MS = 160;                // movement animation duration
const BASE_VISION = 3;

const T_FLOOR = 0;
const T_WALL = 1;
const T_DOOR = 2;
const T_ELEVATOR = 3;
const T_DESK = 4;
const T_CABINET = 5;
const T_WINDOW = 6;

const SOLID = new Set([T_WALL, T_DESK, T_CABINET, T_WINDOW]);

const BASE_MAP: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0,0,0,1],
  [1,0,4,4,0,1,0,4,0,1,1,0,4,0,1,0,4,4,0,1],
  [1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,1],
  [1,0,4,4,0,1,0,4,0,1,1,0,4,0,1,0,4,4,0,1],
  [1,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,1],
  [1,1,1,0,1,1,5,1,1,1,1,1,1,5,1,1,0,1,1,1],
  [6,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,3,0,6],
  [6,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,6],
  [1,1,1,0,1,1,5,1,1,1,1,1,1,5,1,1,0,1,1,1],
  [1,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,1],
  [1,0,4,4,0,1,0,4,0,1,1,0,4,0,1,0,4,4,0,1],
  [1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,1],
  [1,0,4,4,0,1,0,4,0,1,1,0,4,0,1,0,4,4,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// ─── INTERFACES ──────────────────────────────────────────────────────────────
interface Anomaly  { x: number; y: number; id: number; visible: boolean; type: number; }
interface Player   { x: number; y: number; hiding: boolean; }
interface Monster  { x: number; y: number; active: boolean; }
interface Settings { sfx: boolean; crt: boolean; scanlines: boolean; }
interface Upgrades { visionLevel: number; batteryLevel: number; }
interface NetPlayer { id: string; name: string; x: number; y: number; hiding: boolean; dead: boolean; color: string; }
interface MultiState {
  roomId: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  isHost: boolean;
}

const VISION_LEVELS  = [3, 4, 5, 6];
const BATTERY_LEVELS = [20, 28, 38, 50];
const UPGRADE_COSTS  = { vision: [0, 3, 5, 9], battery: [0, 2, 4, 8] };

const ANOMALY_DATA = [
  { symbol: "✦", label: "СИГНАЛ",   color: "#ff3366", glow: "#ff003355" },
  { symbol: "◈", label: "ПОМЕХА",   color: "#ff6600", glow: "#ff440055" },
  { symbol: "⬡", label: "ИСТОЧНИК", color: "#cc00ff", glow: "#9900aa55" },
  { symbol: "⚿", label: "КОНТАКТ",  color: "#00ccff", glow: "#006688aa" },
];

// ─── GAME URL (from func2url.json) ───────────────────────────────────────────
const GAME_URL = "https://functions.poehali.dev/62432b4c-9feb-4e59-a608-ac704a150833";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function isWalkable(x: number, y: number): boolean {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return false;
  return !SOLID.has(BASE_MAP[y][x]);
}

function getWalkable() {
  const r: { x: number; y: number }[] = [];
  for (let row = 1; row < MAP_ROWS - 1; row++)
    for (let col = 1; col < MAP_COLS - 1; col++)
      if (BASE_MAP[row][col] === T_FLOOR) r.push({ x: col, y: row });
  return r;
}

function generateAnomalies(): Anomaly[] {
  const count = Math.floor(Math.random() * 2) + 1;
  const walkable = [...getWalkable()].sort(() => Math.random() - 0.5);
  return walkable.slice(0, count).map((pos, i) => ({
    x: pos.x, y: pos.y, id: i,
    visible: Math.random() > 0.4,
    type: Math.floor(Math.random() * 4),
  }));
}

function bfsPath(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } | null {
  const queue: { x: number; y: number; path: { x: number; y: number }[] }[] = [{ ...from, path: [] }];
  const visited = new Set<string>([`${from.x},${from.y}`]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }]) {
      const nx = cur.x + d.x, ny = cur.y + d.y;
      const key = `${nx},${ny}`;
      if (visited.has(key) || !isWalkable(nx, ny)) continue;
      visited.add(key);
      const newPath = [...cur.path, { x: nx, y: ny }];
      if (nx === to.x && ny === to.y) return newPath[0] ?? null;
      queue.push({ x: nx, y: ny, path: newPath });
    }
  }
  return null;
}

function computeVisible(player: Player, radius: number): Set<string> {
  const visible = new Set<string>([`${player.x},${player.y}`]);
  for (let angle = 0; angle < 360; angle += 3) {
    const rad = (angle * Math.PI) / 180;
    let px = player.x + 0.5, py = player.y + 0.5;
    for (let dist = 0; dist < radius; dist += 0.5) {
      px += Math.cos(rad) * 0.5; py += Math.sin(rad) * 0.5;
      const tx = Math.floor(px), ty = Math.floor(py);
      if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) break;
      visible.add(`${tx},${ty}`);
      if (SOLID.has(BASE_MAP[ty][tx])) break;
    }
  }
  return visible;
}

function getTileColor(tile: number, floor: number): { bg: string; border?: string } {
  switch (tile) {
    case T_WALL:     return { bg: `hsl(220,14%,${8+Math.floor(floor*0.8)}%)`, border: "rgba(255,255,255,0.04)" };
    case T_FLOOR:    return { bg: `hsl(200,5%,${11+floor}%)` };
    case T_DOOR:     return { bg: "linear-gradient(180deg,#7a3e18,#3a1808)", border: "#8B4513" };
    case T_ELEVATOR: return { bg: "linear-gradient(135deg,#0d2a5a,#06102a)", border: "#3a70c9" };
    case T_DESK:     return { bg: `hsl(28,22%,${13+floor}%)`, border: `hsl(28,28%,${18+floor}%)` };
    case T_CABINET:  return { bg: `hsl(210,18%,${12+floor}%)`, border: "rgba(100,150,200,0.15)" };
    case T_WINDOW:   return { bg: "linear-gradient(180deg,#060e1a,#030811)", border: "#0d1e2e" };
    default:         return { bg: "#050508" };
  }
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function Index() {
  const [screen, setScreen]           = useState<Screen>("menu");
  const [floor, setFloor]             = useState(MAX_FLOOR);
  const [player, setPlayer]           = useState<Player>({ x: 9, y: 7, hiding: false });
  const [anomalies, setAnomalies]     = useState<Anomaly[]>([]);
  const [message, setMessage]         = useState("");
  const [clearedFloors, setClearedFloors] = useState<Set<number>>(new Set());
  const [settings, setSettings]       = useState<Settings>({ sfx: true, crt: true, scanlines: true });
  const [flashing, setFlashing]       = useState(false);
  const [win, setWin]                 = useState(false);
  const [foundAnomaly, setFoundAnomaly] = useState(false);
  const [monster, setMonster]         = useState<Monster>({ x: 0, y: 0, active: false });
  const [dead, setDead]               = useState(false);
  const [visibleTiles, setVisibleTiles] = useState<Set<string>>(new Set());
  const [tokens, setTokens]           = useState(0);
  const [upgrades, setUpgrades]       = useState<Upgrades>({ visionLevel: 0, batteryLevel: 0 });
  // Multiplayer
  const [multi, setMulti]             = useState<MultiState | null>(null);
  const [netPlayers, setNetPlayers]   = useState<NetPlayer[]>([]);
  // Seconds until monster spawns (countdown display)
  const [spawnCountdown, setSpawnCountdown] = useState(MONSTER_SPAWN_SECS);

  const msgTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monsterTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnTimer     = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimer      = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtx       = useRef<AudioContext | null>(null);
  const stateRef       = useRef({ floor, player, anomalies, foundAnomaly, monster, dead, clearedFloors, upgrades, multi });

  useEffect(() => {
    stateRef.current = { floor, player, anomalies, foundAnomaly, monster, dead, clearedFloors, upgrades, multi };
  }, [floor, player, anomalies, foundAnomaly, monster, dead, clearedFloors, upgrades, multi]);

  useEffect(() => {
    const radius = VISION_LEVELS[upgrades.visionLevel] ?? BASE_VISION;
    setVisibleTiles(computeVisible(player, radius));
  }, [player.x, player.y, upgrades.visionLevel]);

  // ── AUDIO ──
  const getAudio = useCallback(() => {
    if (!audioCtx.current)
      audioCtx.current = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || AudioContext)();
    return audioCtx.current;
  }, []);

  const playTone = useCallback((freq: number, dur: number, type: OscillatorType = "square", vol = 0.12) => {
    if (!settings.sfx) return;
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
    } catch (_e) { /* ignore */ }
  }, [settings.sfx, getAudio]);

  const playStep    = useCallback(() => playTone(100 + Math.random() * 20, 0.07, "square", 0.04), [playTone]);
  const playLift    = useCallback(() => { playTone(280, 0.12, "sawtooth", 0.1); setTimeout(() => playTone(220, 0.18, "sawtooth", 0.1), 130); }, [playTone]);
  const playAnomaly = useCallback(() => { playTone(80, 0.3, "sawtooth", 0.18); setTimeout(() => playTone(55, 0.5, "sawtooth", 0.18), 220); }, [playTone]);
  const playSuccess = useCallback(() => { [440,550,660,880].forEach((f, i) => setTimeout(() => playTone(f, 0.15, "square", 0.13), i*90)); }, [playTone]);
  const playScream  = useCallback(() => { playTone(120, 0.8, "sawtooth", 0.3); setTimeout(() => playTone(80, 0.6, "sawtooth", 0.25), 400); }, [playTone]);

  const showMsg = useCallback((text: string, ms = 2500) => {
    setMessage(text);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMessage(""), ms);
  }, []);

  // ── MULTIPLAYER SYNC ──
  const syncPlayerPos = useCallback((p: Player) => {
    const { multi: m } = stateRef.current;
    if (!m) return;
    fetch(`${GAME_URL}/?action=move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: m.roomId, playerId: m.playerId, x: p.x, y: p.y, hiding: p.hiding, dead: false }),
    }).catch(() => {});
  }, []);

  const syncRoomState = useCallback((patch: object) => {
    const { multi: m } = stateRef.current;
    if (!m || !m.isHost) return;
    fetch(`${GAME_URL}/?action=room_state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: m.roomId, ...patch }),
    }).catch(() => {});
  }, []);

  const startPolling = useCallback((roomId: string, playerId: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`${GAME_URL}/?action=room&room_id=${roomId}&player_id=${playerId}`);
        const data = await res.json();
        setNetPlayers(data.players || []);
        // Non-host: sync room state from server
        const { multi: m } = stateRef.current;
        if (m && !m.isHost) {
          if (data.floor !== undefined) setFloor(data.floor);
          if (data.anomalies) setAnomalies(data.anomalies);
          if (data.foundAnomaly !== undefined) setFoundAnomaly(data.foundAnomaly);
          if (data.monster) setMonster(data.monster);
        }
      } catch (_e) { /* ignore network errors */ }
    }, 500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
  }, []);

  // ── MONSTER TIMER (500ms, 1 step) ──
  const killMonsterTimers = useCallback(() => {
    if (monsterTimer.current)  { clearInterval(monsterTimer.current);  monsterTimer.current  = null; }
    if (spawnTimer.current)    { clearInterval(spawnTimer.current);    spawnTimer.current    = null; }
  }, []);

  const spawnMonster = useCallback(() => {
    const walkable = getWalkable();
    const { player: p } = stateRef.current;
    const far = walkable.filter(w => Math.abs(w.x - p.x) + Math.abs(w.y - p.y) > 8);
    const pos = (far.length ? far : walkable)[Math.floor(Math.random() * (far.length || walkable.length))];
    const m = { x: pos.x, y: pos.y, active: true };
    setMonster(m);
    syncRoomState({ monster: m });
    showMsg("⚠ ДАТЧИК ДВИЖЕНИЯ — В ЗДАНИИ ЧТО-ТО ЕСТЬ", 3000);
    playAnomaly();

    // 500ms interval, 1 step per tick
    monsterTimer.current = setInterval(() => {
      const { player: pl, monster: mo, dead: isDead } = stateRef.current;
      if (isDead || !mo.active) return;
      if (pl.hiding || BASE_MAP[pl.y][pl.x] === T_ELEVATOR) return;
      const next = bfsPath(mo, pl);
      if (!next) return;
      const newM = { ...mo, x: next.x, y: next.y };
      setMonster(newM);
      syncRoomState({ monster: newM });
      if (next.x === pl.x && next.y === pl.y) {
        setDead(true); playScream();
        showMsg("☠ СХВАЧЕН! Нажми R для рестарта", 99999);
      }
    }, MONSTER_TIMER_MS);
  }, [showMsg, playAnomaly, playScream, syncRoomState]);

  const startSpawnCountdown = useCallback(() => {
    killMonsterTimers();
    setSpawnCountdown(MONSTER_SPAWN_SECS);
    let secs = MONSTER_SPAWN_SECS;
    spawnTimer.current = setInterval(() => {
      secs--;
      setSpawnCountdown(secs);
      if (secs <= 0) {
        if (spawnTimer.current) clearInterval(spawnTimer.current);
        spawnMonster();
      }
    }, 1000);
  }, [killMonsterTimers, spawnMonster]);

  const goToFloor = useCallback((f: number) => {
    killMonsterTimers();
    setMonster({ x: 0, y: 0, active: false });
    const anoms = generateAnomalies();
    setFloor(f); setAnomalies(anoms);
    setPlayer({ x: 9, y: 7, hiding: false });
    setFoundAnomaly(false);
    showMsg(`▶ ЭТАЖ ${f} — ФИКСИРУЮ АКТИВНОСТЬ`, 2800);
    syncRoomState({ floor: f, anomalies: anoms, foundAnomaly: false, monster: { x: 0, y: 0, active: false } });
    startSpawnCountdown();
  }, [showMsg, killMonsterTimers, startSpawnCountdown, syncRoomState]);

  const resetToTop = useCallback(() => {
    killMonsterTimers();
    setMonster({ x: 0, y: 0, active: false });
    const anoms = generateAnomalies();
    setFloor(MAX_FLOOR); setClearedFloors(new Set()); setAnomalies(anoms);
    setPlayer({ x: 9, y: 7, hiding: false }); setFoundAnomaly(false);
    showMsg(`СБРОС — ЭТАЖ ${MAX_FLOOR}`, 2800);
    syncRoomState({ floor: MAX_FLOOR, anomalies: anoms, foundAnomaly: false, monster: { x: 0, y: 0, active: false }, clearedFloors: [] });
    startSpawnCountdown();
  }, [showMsg, killMonsterTimers, startSpawnCountdown, syncRoomState]);

  const startGame = useCallback(() => {
    killMonsterTimers();
    const anoms = generateAnomalies();
    setFloor(MAX_FLOOR); setAnomalies(anoms);
    setPlayer({ x: 9, y: 7, hiding: false });
    setWin(false); setFlashing(false); setFoundAnomaly(false);
    setMessage(""); setDead(false); setMonster({ x: 0, y: 0, active: false });
    setClearedFloors(new Set());
    setScreen("game");
    showMsg(`▶ ЭТАЖ ${MAX_FLOOR} — НАЧИНАЕМ МИССИЮ`, 3000);
    startSpawnCountdown();
  }, [showMsg, killMonsterTimers, startSpawnCountdown]);

  // ── LIFT ──
  const activateLift = useCallback((direction: "up" | "down") => {
    const { floor: curFloor, player: curPlayer, anomalies: curAnomalies, foundAnomaly: curFound, clearedFloors: cleared } = stateRef.current;
    const liftCol = 17, liftRow = 7;
    if (Math.abs(curPlayer.x - liftCol) > 2 || Math.abs(curPlayer.y - liftRow) > 2) {
      showMsg("Подойди к лифту (правая сторона)", 2000); return;
    }
    if (direction === "up") {
      if (!curFound) {
        showMsg(curAnomalies.length === 0 ? "❌ НА ЭТАЖЕ ЧИСТО — используй ВНИЗ [F]" : "Сначала найди аномалию — нажми [E]", 2500);
        return;
      }
      const newCleared = new Set(cleared).add(curFloor);
      setClearedFloors(newCleared);
      setTokens(t => t + 1);
      playLift();
      if (curFloor <= 1) { playSuccess(); setWin(true); return; }
      showMsg(`✓ ЗАФИКСИРОВАНО +1🪙 — ЭТАЖ ${curFloor - 1}`, 2200);
      goToFloor(curFloor - 1);
    } else {
      if (curAnomalies.length > 0 && !curFound) {
        showMsg("❌ АНОМАЛИЯ НЕ ЗАФИКСИРОВАНА!", 3000);
        setFlashing(true); playAnomaly();
        setTimeout(() => { setFlashing(false); resetToTop(); }, 1200);
        return;
      }
      const newCleared = new Set(cleared).add(curFloor);
      setClearedFloors(newCleared);
      playLift();
      if (curFloor <= 1) { playSuccess(); setWin(true); return; }
      showMsg(`▶ ЭТАЖ ЧИСТ — ЕДЕМ НА ${curFloor - 1}`, 2000);
      goToFloor(curFloor - 1);
    }
  }, [showMsg, playAnomaly, playLift, playSuccess, goToFloor, resetToTop]);

  // ── INSPECT ──
  const inspect = useCallback(() => {
    const { player: p, anomalies: a } = stateRef.current;
    const nearby = a.find(an => Math.abs(an.x - p.x) <= 1 && Math.abs(an.y - p.y) <= 1);
    if (nearby) {
      setFoundAnomaly(true); playAnomaly(); setFlashing(true);
      showMsg(`▶ АНОМАЛИЯ: ${ANOMALY_DATA[nearby.type].label} — Жми [Q] у лифта`, 4000);
      setTimeout(() => setFlashing(false), 500);
      const updated = stateRef.current.anomalies.map(an => an.id === nearby.id ? { ...an, visible: true } : an);
      setAnomalies(updated);
      syncRoomState({ anomalies: updated, foundAnomaly: true });
    } else {
      playTone(200, 0.06, "square", 0.05);
      showMsg("Здесь ничего нет.", 1500);
    }
  }, [playAnomaly, playTone, showMsg, syncRoomState]);

  // ── MOVE (with smooth animation trigger via CSS) ──
  const movePlayer = useCallback((dir: Direction) => {
    const { dead: isDead } = stateRef.current;
    if (isDead) return;
    setPlayer(prev => {
      let nx = prev.x, ny = prev.y;
      if (dir === "left") nx--; if (dir === "right") nx++;
      if (dir === "up")   ny--; if (dir === "down")  ny++;
      if (!isWalkable(nx, ny)) return prev;
      playStep();
      const next = { x: nx, y: ny, hiding: false };
      syncPlayerPos(next);
      return next;
    });
  }, [playStep, syncPlayerPos]);

  // ── HIDE IN CABINET ──
  const hideInCabinet = useCallback(() => {
    const { player: p, dead: isDead } = stateRef.current;
    if (isDead) return;
    const near = [{ x: p.x-1, y: p.y }, { x: p.x+1, y: p.y }, { x: p.x, y: p.y-1 }, { x: p.x, y: p.y+1 }]
      .some(q => q.x >= 0 && q.y >= 0 && q.x < MAP_COLS && q.y < MAP_ROWS && BASE_MAP[q.y][q.x] === T_CABINET);
    if (near) {
      setPlayer(prev => {
        const next = { ...prev, hiding: !prev.hiding };
        syncPlayerPos(next);
        return next;
      });
      showMsg(stateRef.current.player.hiding ? "Вышел из укрытия" : "🫥 В шкафу — монстр не найдёт", 2500);
    } else {
      showMsg("Нет шкафа рядом", 1200);
    }
  }, [showMsg, syncPlayerPos]);

  // ── KEYBOARD ──
  useEffect(() => {
    if (screen !== "game") return;
    const handler = (e: KeyboardEvent) => {
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
      const { dead: isDead } = stateRef.current;
      if (e.key === "r" || e.key === "R") { startGame(); return; }
      if (e.key === "p" || e.key === "P") { setScreen("shop"); return; }
      if (isDead || win) return;
      if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") movePlayer("left");
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") movePlayer("right");
      if (e.key === "ArrowUp"    || e.key === "w" || e.key === "W") movePlayer("up");
      if (e.key === "ArrowDown"  || e.key === "s" || e.key === "S") movePlayer("down");
      if (e.key === "e" || e.key === "E" || e.key === " ") inspect();
      if (e.key === "q" || e.key === "Q") activateLift("up");
      if (e.key === "f" || e.key === "F") activateLift("down");
      if (e.key === "h" || e.key === "H") hideInCabinet();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen, movePlayer, inspect, activateLift, win, startGame, hideInCabinet]);

  useEffect(() => () => { killMonsterTimers(); stopPolling(); }, [killMonsterTimers, stopPolling]);

  // ── MULTIPLAYER HANDLERS ──
  const createRoom = useCallback(async (name: string) => {
    const res = await fetch(`${GAME_URL}/?action=create`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    const m: MultiState = { roomId: data.roomId, playerId: data.playerId, playerName: name, playerColor: data.color, isHost: true };
    setMulti(m);
    startPolling(data.roomId, data.playerId);
    heartbeatTimer.current = setInterval(() => {
      fetch(`${GAME_URL}/?action=heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: data.roomId, playerId: data.playerId }) }).catch(() => {});
    }, 2000);
    startGame();
  }, [startGame, startPolling]);

  const joinRoom = useCallback(async (roomId: string, name: string) => {
    const res = await fetch(`${GAME_URL}/?action=join`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, name }),
    });
    const data = await res.json();
    if (data.error) { showMsg("❌ Комната не найдена", 3000); return; }
    const m: MultiState = { roomId: data.roomId, playerId: data.playerId, playerName: name, playerColor: data.color, isHost: false };
    setMulti(m);
    startPolling(data.roomId, data.playerId);
    heartbeatTimer.current = setInterval(() => {
      fetch(`${GAME_URL}/?action=heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: data.roomId, playerId: data.playerId }) }).catch(() => {});
    }, 2000);
    startGame();
  }, [showMsg, startGame, startPolling]);

  // ── SCREEN ROUTING ──
  const monsterDelay = BATTERY_LEVELS[upgrades.batteryLevel] ?? 20;
  void monsterDelay;

  if (screen === "menu")     return <MenuScreen onStart={startGame} onSettings={() => setScreen("settings")} onLobby={() => setScreen("lobby")} />;
  if (screen === "settings") return <SettingsScreen settings={settings} setSettings={setSettings} onBack={() => setScreen("menu")} />;
  if (screen === "lobby")    return <LobbyScreen onCreate={createRoom} onJoin={joinRoom} onBack={() => setScreen("menu")} />;
  if (screen === "shop")     return (
    <ShopScreen tokens={tokens} upgrades={upgrades}
      onBuy={(type) => {
        const { upgrades: upg } = stateRef.current;
        if (type === "vision") {
          const lv = upg.visionLevel + 1;
          if (lv >= VISION_LEVELS.length) return;
          const cost = UPGRADE_COSTS.vision[lv];
          if (tokens < cost) return;
          setTokens(t => t - cost); setUpgrades(u => ({ ...u, visionLevel: lv }));
        } else {
          const lv = upg.batteryLevel + 1;
          if (lv >= BATTERY_LEVELS.length) return;
          const cost = UPGRADE_COSTS.battery[lv];
          if (tokens < cost) return;
          setTokens(t => t - cost); setUpgrades(u => ({ ...u, batteryLevel: lv }));
        }
      }}
      onBack={() => setScreen("game")}
    />
  );

  return (
    <GameScreen
      floor={floor} player={player} anomalies={anomalies} message={message}
      flashing={flashing} win={win} settings={settings} foundAnomaly={foundAnomaly}
      monster={monster} dead={dead} visibleTiles={visibleTiles}
      spawnCountdown={spawnCountdown} tokens={tokens} upgrades={upgrades}
      netPlayers={netPlayers} multi={multi}
      onMove={movePlayer} onInspect={inspect}
      onLiftUp={() => activateLift("up")} onLiftDown={() => activateLift("down")}
      onHide={hideInCabinet}
      onMenu={() => setScreen("menu")} onRestart={startGame}
      onShop={() => setScreen("shop")}
    />
  );
}

// ─── LOBBY ────────────────────────────────────────────────────────────────────
function LobbyScreen({ onCreate, onJoin, onBack }: {
  onCreate: (name: string) => void;
  onJoin: (roomId: string, name: string) => void;
  onBack: () => void;
}) {
  const [name, setName]     = useState("АГЕНТ");
  const [roomId, setRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab]       = useState<"create" | "join">("create");

  const handleCreate = async () => { setLoading(true); await onCreate(name); setLoading(false); };
  const handleJoin   = async () => { setLoading(true); await onJoin(roomId.toUpperCase(), name); setLoading(false); };

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Press Start 2P', monospace", color: "#00ff88", userSelect: "none",
    }}>
      <div style={{ fontSize: 7, color: "#226622", marginBottom: 10, letterSpacing: 4 }}>▓▓▓ МУЛЬТИПЛЕЕР ▓▓▓</div>

      <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
        {(["create", "join"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontFamily: "'Press Start 2P', monospace", fontSize: 8, padding: "8px 18px",
            background: tab === t ? "#00ff88" : "#080808",
            color: tab === t ? "#000" : "#446644",
            border: "2px solid #226622", cursor: "pointer",
          }}>{t === "create" ? "СОЗДАТЬ" : "ВОЙТИ"}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 280 }}>
        <div>
          <div style={{ fontSize: 7, color: "#446644", marginBottom: 6 }}>ИМЯ АГЕНТА</div>
          <input value={name} onChange={e => setName(e.target.value.toUpperCase().slice(0, 12))}
            style={{ width: "100%", fontFamily: "'Press Start 2P', monospace", fontSize: 9,
              background: "#050a05", color: "#00ff88", border: "2px solid #226622",
              padding: "8px", outline: "none", boxSizing: "border-box" }} />
        </div>

        {tab === "join" && (
          <div>
            <div style={{ fontSize: 7, color: "#446644", marginBottom: 6 }}>КОД КОМНАТЫ</div>
            <input value={roomId} onChange={e => setRoomId(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="XXXXXX"
              style={{ width: "100%", fontFamily: "'Press Start 2P', monospace", fontSize: 12,
                background: "#050a05", color: "#ff9900", border: "2px solid #226622",
                padding: "8px", outline: "none", boxSizing: "border-box", letterSpacing: 4 }} />
          </div>
        )}

        <PixelBtn onClick={tab === "create" ? handleCreate : handleJoin}
          color="#00ff88">
          {loading ? "..." : tab === "create" ? "▶ СОЗДАТЬ КОМНАТУ" : "▶ ВОЙТИ"}
        </PixelBtn>
      </div>

      <div style={{ marginTop: 28 }}>
        <PixelBtn onClick={onBack} color="#ff9900">← НАЗАД</PixelBtn>
      </div>
    </div>
  );
}

// ─── MENU ────────────────────────────────────────────────────────────────────
function MenuScreen({ onStart, onSettings, onLobby }: { onStart: () => void; onSettings: () => void; onLobby: () => void }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { const t = setInterval(() => setBlink(b => !b), 550); return () => clearInterval(t); }, []);

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Press Start 2P', monospace", color: "#00ff88",
      position: "relative", overflow: "hidden", userSelect: "none",
    }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 31px,rgba(0,255,136,0.03) 31px,rgba(0,255,136,0.03) 32px)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 120%, rgba(0,60,20,0.55) 0%, transparent 60%)" }} />

      <div style={{ fontSize: 7, color: "#ff336677", marginBottom: 12, letterSpacing: 6 }}>▓▓▓ ELEVATOR PROTOCOL v2.1 ▓▓▓</div>
      <h1 style={{ fontSize: "clamp(28px,5vw,52px)", textAlign: "center", lineHeight: 1.4, marginBottom: 8,
        textShadow: "0 0 20px #00ff88, 0 0 50px #00ff4444" }}>ЛИФТ</h1>
      <div style={{ fontSize: 9, color: "#ff9900", marginBottom: 36, letterSpacing: 3, textShadow: "0 0 8px #ff990055" }}>
        ОХОТНИК ЗА АНОМАЛИЯМИ
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", marginBottom: 36 }}>
        <PixelBtn onClick={onStart} color="#00ff88">▶  ОДИНОЧНАЯ</PixelBtn>
        <PixelBtn onClick={onLobby} color="#4488ff">👥 МУЛЬТИПЛЕЕР</PixelBtn>
        <PixelBtn onClick={onSettings} color="#ff9900">⚙  НАСТРОЙКИ</PixelBtn>
      </div>

      <div style={{ fontSize: 6, color: "#335533", textAlign: "center", lineHeight: 2.8 }}>
        {blink ? "[ WASD / СТРЕЛКИ — ДВИЖЕНИЕ ]" : <span style={{ opacity: 0 }}>X</span>}<br/>
        [ E — ОСМОТР ]  [ H — ШКАФ ]  [ P — МАГАЗИН ]<br/>
        [ Q — ЛИФТ (аномалия) ]  [ F — ЛИФТ (чисто) ]
      </div>
      <div style={{ position: "absolute", bottom: 18, fontSize: 6, color: "#1a3322", textAlign: "center" }}>
        МИССИЯ: СПУСТИСЬ С ЭТАЖА 8 НА ЭТАЖ 1 ✦ ИЗБЕГАЙ МОНСТРА ✦ ПРЯЧЬСЯ В ШКАФАХ
      </div>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function SettingsScreen({ settings, setSettings, onBack }: {
  settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; onBack: () => void;
}) {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Press Start 2P', monospace", color: "#00ff88" }}>
      <div style={{ fontSize: 7, color: "#336644", marginBottom: 12, letterSpacing: 4 }}>▓▓▓ НАСТРОЙКИ ▓▓▓</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 300, marginBottom: 44 }}>
        {([ ["ЗВУКИ", "sfx"], ["CRT ЭФФЕКТ", "crt"], ["СКАНЛАЙНЫ", "scanlines"] ] as [string, keyof Settings][]).map(([label, key]) => (
          <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, color: "#aaa" }}>{label}</span>
            <button onClick={() => setSettings(s => ({ ...s, [key]: !s[key] }))} style={{
              fontFamily: "'Press Start 2P', monospace", fontSize: 8, padding: "7px 14px",
              background: settings[key] ? "#00ff88" : "#111", color: settings[key] ? "#000" : "#444",
              border: `2px solid ${settings[key] ? "#00ff88" : "#333"}`, cursor: "pointer",
            }}>{settings[key] ? "ВКЛ" : "ВЫКЛ"}</button>
          </div>
        ))}
      </div>
      <PixelBtn onClick={onBack} color="#ff9900">← НАЗАД</PixelBtn>
    </div>
  );
}

// ─── SHOP ────────────────────────────────────────────────────────────────────
function ShopScreen({ tokens, upgrades, onBuy, onBack }: {
  tokens: number; upgrades: Upgrades; onBuy: (t: "vision"|"battery") => void; onBack: () => void;
}) {
  const vLv = upgrades.visionLevel, bLv = upgrades.batteryLevel;
  const vMax = vLv + 1 >= VISION_LEVELS.length, bMax = bLv + 1 >= BATTERY_LEVELS.length;
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Press Start 2P', monospace", color: "#00ff88", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 31px,rgba(0,255,136,0.025) 31px,rgba(0,255,136,0.025) 32px)" }} />
      <div style={{ fontSize: 7, color: "#226622", marginBottom: 8, letterSpacing: 4 }}>▓▓▓ МАГАЗИН ▓▓▓</div>
      <div style={{ fontSize: 9, color: "#ff9900", marginBottom: 32 }}>ТОКЕНЫ: <span style={{ color: "#fff" }}>{tokens}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, width: 340 }}>
        <ShopItem icon="🔦" title="ФОНАРИК"
          desc={vMax ? "МАКСИМУМ" : `Радиус: ${VISION_LEVELS[vLv]} → ${VISION_LEVELS[vLv+1]} клеток`}
          level={vLv} maxLevel={VISION_LEVELS.length-1}
          cost={vMax ? 0 : UPGRADE_COSTS.vision[vLv+1]} tokens={tokens} maxed={vMax}
          onBuy={() => onBuy("vision")} />
        <ShopItem icon="🔋" title="БАТАРЕЙКА"
          desc={bMax ? "МАКСИМУМ" : `Шагов до монстра: ${BATTERY_LEVELS[bLv]} → ${BATTERY_LEVELS[bLv+1]}`}
          level={bLv} maxLevel={BATTERY_LEVELS.length-1}
          cost={bMax ? 0 : UPGRADE_COSTS.battery[bLv+1]} tokens={tokens} maxed={bMax}
          onBuy={() => onBuy("battery")} />
      </div>
      <div style={{ marginTop: 36 }}><PixelBtn onClick={onBack} color="#ff9900">← ВЕРНУТЬСЯ</PixelBtn></div>
    </div>
  );
}

function ShopItem({ icon, title, desc, level, maxLevel, cost, tokens, maxed, onBuy }: {
  icon: string; title: string; desc: string; level: number; maxLevel: number;
  cost: number; tokens: number; maxed: boolean; onBuy: () => void;
}) {
  const canAfford = tokens >= cost && !maxed;
  return (
    <div style={{ border: `2px solid ${maxed ? "#226622" : "#334433"}`, padding: "14px 18px",
      display: "flex", flexDirection: "column", gap: 8, background: "#050a05" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#aaa" }}>{icon} {title}</span>
        <div style={{ display: "flex", gap: 3 }}>
          {Array.from({ length: maxLevel }).map((_, i) => (
            <div key={i} style={{ width: 10, height: 6, background: i < level ? "#00ff88" : "#111", border: "1px solid #224422" }} />
          ))}
        </div>
      </div>
      <div style={{ fontSize: 7, color: "#446644" }}>{desc}</div>
      <button onClick={onBuy} disabled={!canAfford} style={{
        fontFamily: "'Press Start 2P', monospace", fontSize: 8, padding: "8px 0",
        background: maxed ? "#0a180a" : canAfford ? "#00ff88" : "#0f1a0f",
        color: maxed ? "#226622" : canAfford ? "#000" : "#224422",
        border: `2px solid ${maxed ? "#1a3a1a" : canAfford ? "#00ff88" : "#1a3a1a"}`,
        cursor: canAfford ? "pointer" : "default",
      }}>{maxed ? "УЛУЧШЕНО" : `КУПИТЬ — ${cost}🪙`}</button>
    </div>
  );
}

// ─── PIXEL BTN ────────────────────────────────────────────────────────────────
function PixelBtn({ onClick, children, color }: { onClick: () => void; children: React.ReactNode; color: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, padding: "13px 28px",
        background: hover ? color : "transparent", color: hover ? "#000" : color,
        border: `3px solid ${color}`, cursor: "pointer",
        boxShadow: hover ? `0 0 22px ${color}66` : "none", transition: "all 0.08s", letterSpacing: 1 }}>
      {children}
    </button>
  );
}

// ─── ANIMATED SPRITE ─────────────────────────────────────────────────────────
// Renders entity at (x, y) with CSS transform for smooth movement
function AnimSprite({ x, y, cellSize, zIndex, children }: {
  x: number; y: number; cellSize: number; zIndex: number; children: React.ReactNode;
}) {
  return (
    <div style={{
      position: "absolute",
      left: 0, top: 0,
      width: cellSize, height: cellSize,
      transform: `translate(${x * cellSize}px, ${y * cellSize}px)`,
      transition: `transform ${ANIM_MS}ms linear`,
      zIndex,
      display: "flex", alignItems: "center", justifyContent: "center",
      pointerEvents: "none",
    }}>
      {children}
    </div>
  );
}

// ─── GAME SCREEN ──────────────────────────────────────────────────────────────
function GameScreen({
  floor, player, anomalies, message, flashing, win, settings, foundAnomaly,
  monster, dead, visibleTiles, spawnCountdown, tokens, upgrades,
  netPlayers, multi,
  onMove, onInspect, onLiftUp, onLiftDown, onHide, onMenu, onRestart, onShop,
}: {
  floor: number; player: Player; anomalies: Anomaly[]; message: string;
  flashing: boolean; win: boolean; settings: Settings; foundAnomaly: boolean;
  monster: Monster; dead: boolean; visibleTiles: Set<string>;
  spawnCountdown: number; tokens: number; upgrades: Upgrades;
  netPlayers: NetPlayer[]; multi: MultiState | null;
  onMove: (d: Direction) => void; onInspect: () => void;
  onLiftUp: () => void; onLiftDown: () => void; onHide: () => void;
  onMenu: () => void; onRestart: () => void; onShop: () => void;
}) {
  const [cellSize, setCellSize] = useState(32);

  useEffect(() => {
    const calc = () => {
      const panelW = 190;
      const availW = window.innerWidth - panelW - 24;
      const availH = window.innerHeight - 56 - 40 - 90;
      setCellSize(Math.max(14, Math.min(Math.floor(Math.min(availW / MAP_COLS, availH / MAP_ROWS)), 40)));
    };
    calc(); window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const mapW = cellSize * MAP_COLS;
  const mapH = cellSize * MAP_ROWS;
  const hasAnomaly = anomalies.length > 0;
  const monsterVisible = monster.active && visibleTiles.has(`${monster.x},${monster.y}`);
  const batteryPct = monster.active ? 0 : Math.min(spawnCountdown / MONSTER_SPAWN_SECS, 1);

  // Other network players (not self)
  const otherPlayers = multi ? netPlayers.filter(p => p.id !== multi.playerId) : [];

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: dead ? "#110000" : flashing ? "#110003" : "#040407",
      display: "flex", flexDirection: "column",
      fontFamily: "'VT323', monospace", overflow: "hidden", userSelect: "none",
      transition: "background 0.15s",
    }}>
      {settings.crt && <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 100,
        background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.82) 100%)" }} />}
      {settings.scanlines && <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 99,
        backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.14) 2px,rgba(0,0,0,0.14) 4px)" }} />}

      {/* HUD */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 14px", background: "#07070c", borderBottom: "2px solid #12122a", flexShrink: 0, minHeight: 52, gap: 6 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, color: "#446644" }}>ЭТАЖ</div>
            <div style={{ fontSize: 28, color: "#fff", lineHeight: 1, textShadow: "0 0 12px #ff990088" }}>{floor}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column-reverse", gap: 2 }}>
            {Array.from({ length: MAX_FLOOR }, (_, i) => i + 1).map(f => (
              <div key={f} style={{ width: 9, height: 4,
                background: f > floor ? "#1a1a1a" : f === floor ? "#ff9900" : "#00aa55",
                boxShadow: f === floor ? "0 0 8px #ff9900" : "none", transition: "all 0.3s" }} />
            ))}
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, letterSpacing: 2,
            color: dead ? "#ff0000" : !hasAnomaly ? "#00ff88" : foundAnomaly ? "#ff9900" : "#ff3366",
            textShadow: "0 0 8px currentColor" }}>
            {dead ? "☠ МЁРТВ" : !hasAnomaly ? "✓ ЧИСТ" : foundAnomaly ? "◈ НАЙДЕНО" : "✦ АНОМАЛИЯ"}
          </div>
          <div style={{ fontSize: 10, color: "#334433", marginTop: 1 }}>
            {dead ? "R — рестарт" : !hasAnomaly ? "→ ВНИЗ [F]" : foundAnomaly ? "→ ЛИФТ [Q]" : "→ ОСМОТР [E]"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {monster.active && !dead && (
              <div style={{ fontSize: 11, color: "#ff0000", textShadow: "0 0 8px #ff0000", animation: "anomaly-pulse 0.7s ease-in-out infinite" }}>◉ МОНСТР</div>
            )}
            {player.hiding && <div style={{ fontSize: 11, color: "#4488ff" }}>🫥 СКРЫТ</div>}
            {multi && <div style={{ fontSize: 10, color: multi.playerColor }}>{multi.playerName}</div>}
            <div style={{ fontSize: 11, color: "#664400" }}>🪙{tokens}</div>
          </div>
          {/* Countdown / battery bar */}
          {!monster.active && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: batteryPct < 0.3 ? "#ff3300" : "#446644" }}>🔦</span>
              <div style={{ width: 50, height: 5, background: "#111", border: "1px solid #222" }}>
                <div style={{ width: `${batteryPct * 100}%`, height: "100%",
                  background: batteryPct < 0.3 ? "#ff3300" : batteryPct < 0.6 ? "#ff9900" : "#00ff88",
                  transition: "width 1s linear" }} />
              </div>
              <span style={{ fontSize: 9, color: batteryPct < 0.3 ? "#ff3300" : "#334433" }}>{spawnCountdown}с</span>
            </div>
          )}
          {/* Online players count */}
          {multi && netPlayers.length > 0 && (
            <div style={{ fontSize: 9, color: "#334455" }}>👥 {netPlayers.length} онлайн</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={onShop} style={{ fontFamily: "'VT323', monospace", fontSize: 14,
            background: "transparent", color: "#aa8800", border: "1px solid #443300",
            padding: "3px 8px", cursor: "pointer" }}>🪙[P]</button>
          <button onClick={onMenu} style={{ fontFamily: "'VT323', monospace", fontSize: 14,
            background: "transparent", color: "#333", border: "1px solid #222",
            padding: "3px 8px", cursor: "pointer" }}>МЕНЮ</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
          <div style={{ width: mapW, height: mapH, position: "relative", flexShrink: 0,
            boxShadow: "0 0 0 2px #12122a, 0 0 40px rgba(0,0,0,0.9)", overflow: "hidden" }}>

            {/* Tiles */}
            {BASE_MAP.map((row, ry) => row.map((tile, cx) => {
              const isVisible = visibleTiles.has(`${cx},${ry}`);
              const tc = getTileColor(tile, floor);
              return (
                <div key={`${ry}-${cx}`} style={{
                  position: "absolute", left: cx * cellSize, top: ry * cellSize,
                  width: cellSize, height: cellSize,
                  background: isVisible ? tc.bg : "#010102",
                  borderRight: tc.border && isVisible ? `1px solid ${tc.border}` : undefined,
                  borderBottom: tc.border && isVisible ? `1px solid ${tc.border}` : undefined,
                }}>
                  {tile === T_ELEVATOR && isVisible && (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cellSize * 0.52 }}>🛗</div>
                  )}
                  {tile === T_CABINET && isVisible && (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cellSize * 0.4, color: "#446" }}>▣</div>
                  )}
                  {tile === T_DOOR && isVisible && (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cellSize * 0.45, color: "#8B4513" }}>▬</div>
                  )}
                  {!isVisible && <div style={{ position: "absolute", inset: 0, background: "#010102" }} />}
                </div>
              );
            }))}

            {/* Anomalies */}
            {anomalies.filter(a => a.visible && visibleTiles.has(`${a.x},${a.y}`)).map(a => {
              const ad = ANOMALY_DATA[a.type];
              return (
                <AnimSprite key={a.id} x={a.x} y={a.y} cellSize={cellSize} zIndex={5}>
                  <span style={{ fontSize: cellSize * 0.7, color: ad.color,
                    textShadow: `0 0 8px ${ad.color}, 0 0 20px ${ad.glow}`,
                    animation: "anomaly-pulse 1.4s ease-in-out infinite", fontFamily: "monospace" }}>
                    {ad.symbol}
                  </span>
                </AnimSprite>
              );
            })}

            {/* Other network players */}
            {otherPlayers.map(np => (
              <AnimSprite key={np.id} x={np.x} y={np.y} cellSize={cellSize} zIndex={9}>
                {np.hiding
                  ? <span style={{ fontSize: cellSize * 0.5, opacity: 0.4 }}>👤</span>
                  : <svg width={cellSize * 0.75} height={cellSize * 0.88} viewBox="0 0 12 14" style={{ imageRendering: "pixelated" }}>
                      <rect x="3" y="0" width="6" height="5" fill={np.color} />
                      <rect x="4" y="2" width="1" height="1" fill="#222" />
                      <rect x="7" y="2" width="1" height="1" fill="#222" />
                      <rect x="2" y="5" width="8" height="6" fill={np.color + "99"} />
                      <rect x="3" y="11" width="2" height="3" fill="#1a1a2a" />
                      <rect x="7" y="11" width="2" height="3" fill="#1a1a2a" />
                    </svg>
                }
                <span style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                  fontSize: 6, color: np.color, whiteSpace: "nowrap", fontFamily: "'Press Start 2P',monospace" }}>
                  {np.name.slice(0, 6)}
                </span>
              </AnimSprite>
            ))}

            {/* Monster */}
            {monsterVisible && (
              <AnimSprite x={monster.x} y={monster.y} cellSize={cellSize} zIndex={8}>
                <svg width={cellSize * 0.8} height={cellSize * 0.9} viewBox="0 0 12 14" style={{ imageRendering: "pixelated" }}>
                  <rect x="2" y="1" width="8" height="6" fill="#660000" />
                  <rect x="1" y="2" width="10" height="4" fill="#880000" />
                  <rect x="3" y="3" width="2" height="2" fill="#ff0000" />
                  <rect x="7" y="3" width="2" height="2" fill="#ff0000" />
                  <rect x="3" y="3" width="1" height="1" fill="#ffffff" />
                  <rect x="7" y="3" width="1" height="1" fill="#ffffff" />
                  <rect x="4" y="5" width="4" height="1" fill="#ff3300" />
                  <rect x="2" y="7" width="8" height="5" fill="#550000" />
                  <rect x="1" y="8" width="2" height="3" fill="#440000" />
                  <rect x="9" y="8" width="2" height="3" fill="#440000" />
                  <rect x="3" y="12" width="2" height="2" fill="#330000" />
                  <rect x="7" y="12" width="2" height="2" fill="#330000" />
                </svg>
              </AnimSprite>
            )}

            {/* Player */}
            <AnimSprite x={player.x} y={player.y} cellSize={cellSize} zIndex={10}>
              {player.hiding
                ? <span style={{ fontSize: cellSize * 0.55, opacity: 0.4 }}>👤</span>
                : <svg width={cellSize * 0.75} height={cellSize * 0.88} viewBox="0 0 12 14" style={{ imageRendering: "pixelated" }}>
                    <rect x="3" y="0" width="6" height="5" fill="#f5c842" />
                    <rect x="4" y="2" width="1" height="1" fill="#222" />
                    <rect x="7" y="2" width="1" height="1" fill="#222" />
                    <rect x="4" y="4" width="4" height="1" fill="#c8a030" />
                    <rect x="2" y="5" width="8" height="6" fill="#2244bb" />
                    <rect x="1" y="6" width="2" height="4" fill="#1a3399" />
                    <rect x="9" y="6" width="2" height="4" fill="#1a3399" />
                    <rect x="3" y="11" width="2" height="3" fill="#1a1a2a" />
                    <rect x="7" y="11" width="2" height="3" fill="#1a1a2a" />
                  </svg>
              }
            </AnimSprite>

            {/* Win / Dead overlays */}
            {win && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,20,10,0.92)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                zIndex: 50, fontFamily: "'Press Start 2P', monospace" }}>
                <div style={{ fontSize: 20, color: "#00ff88", textShadow: "0 0 30px #00ff88", marginBottom: 16 }}>ПОБЕДА!</div>
                <div style={{ fontSize: 7, color: "#aa8800", marginBottom: 28 }}>ТОКЕНОВ: {tokens}</div>
                <PixelBtn onClick={onRestart} color="#00ff88">▶ СНОВА</PixelBtn>
              </div>
            )}
            {dead && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(20,0,0,0.92)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                zIndex: 50, fontFamily: "'Press Start 2P', monospace" }}>
                <div style={{ fontSize: 20, color: "#ff0000", textShadow: "0 0 30px #ff0000", marginBottom: 16 }}>☠ КОНЕЦ</div>
                <div style={{ fontSize: 8, color: "#663333", marginBottom: 28 }}>МОНСТР ПОЙМАЛ ВАС</div>
                <PixelBtn onClick={onRestart} color="#ff3366">▶ СНОВА [R]</PixelBtn>
              </div>
            )}
          </div>
        </div>

        {/* SIDE PANEL */}
        <div style={{ width: 190, background: "#07070c", borderLeft: "2px solid #12122a",
          display: "flex", flexDirection: "column", padding: 10, gap: 9, flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#225533", letterSpacing: 2 }}>ЛИФТ</div>
          <button onClick={onLiftUp} style={{ fontFamily: "'VT323', monospace", fontSize: 17, padding: "7px 0", lineHeight: 1.5,
            background: "#090c09", color: "#ff3366", border: "2px solid #ff3366", cursor: "pointer" }}>
            ▲ ВВЕРХ [Q]<br/><span style={{ fontSize: 10, color: "#552233" }}>АНОМАЛИЯ</span></button>
          <button onClick={onLiftDown} style={{ fontFamily: "'VT323', monospace", fontSize: 17, padding: "7px 0", lineHeight: 1.5,
            background: "#090c09", color: "#00ff88", border: "2px solid #00ff88", cursor: "pointer" }}>
            ▼ ВНИЗ [F]<br/><span style={{ fontSize: 10, color: "#224433" }}>ЧИСТО</span></button>

          <div style={{ fontSize: 11, color: "#225533", letterSpacing: 2, marginTop: 2 }}>ДЕЙСТВИЯ</div>
          <button onClick={onInspect} style={{ fontFamily: "'VT323', monospace", fontSize: 16, padding: "6px 0", lineHeight: 1.5,
            background: "#090910", color: "#4488ff", border: "2px solid #4488ff", cursor: "pointer" }}>◈ ОСМОТР [E]</button>
          <button onClick={onHide} style={{ fontFamily: "'VT323', monospace", fontSize: 16, padding: "6px 0", lineHeight: 1.5,
            background: "#090910", color: "#8844ff", border: "2px solid #8844ff", cursor: "pointer" }}>🫥 ШКАФ [H]</button>
          <button onClick={onShop} style={{ fontFamily: "'VT323', monospace", fontSize: 16, padding: "6px 0", lineHeight: 1.5,
            background: "#0a0800", color: "#aa8800", border: "2px solid #aa8800", cursor: "pointer" }}>🪙 МАГАЗИН [P]</button>

          {/* Online players list */}
          {netPlayers.length > 0 && (
            <div style={{ marginTop: 4, borderTop: "1px solid #111", paddingTop: 6 }}>
              <div style={{ fontSize: 9, color: "#225533", marginBottom: 4 }}>В ИГРЕ</div>
              {netPlayers.map(p => (
                <div key={p.id} style={{ fontSize: 10, color: p.color, marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, background: p.color, display: "inline-block", borderRadius: "50%", flexShrink: 0 }} />
                  {p.name.slice(0, 8)}{p.dead ? " ☠" : ""}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: "auto", fontSize: 9, color: "#1a2a1a", lineHeight: 2.2, borderTop: "1px solid #111", paddingTop: 6 }}>
            WASD — движение<br/>E — осмотр<br/>H — шкаф<br/>Q — лифт↑<br/>F — лифт↓<br/>R — рестарт
          </div>
        </div>
      </div>

      {/* MESSAGE BAR */}
      <div style={{ height: 40, background: "#05050a", borderTop: "2px solid #12122a",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {message && (
          <div style={{ fontSize: 19,
            color: message.includes("❌") || message.includes("☠") ? "#ff3366"
              : message.includes("▶") || message.includes("✓") || message.includes("◈") ? "#ff9900" : "#888",
            textShadow: "0 0 6px currentColor" }}>{message}</div>
        )}
      </div>

      {/* MOBILE D-PAD */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        gap: 3, padding: "5px 0 7px", background: "#05050a", borderTop: "1px solid #111", flexShrink: 0 }}>
        <MBtn onClick={() => onMove("up")}>▲</MBtn>
        <div style={{ display: "flex", gap: 3 }}>
          <MBtn onClick={() => onMove("left")}>◀</MBtn>
          <MBtn onClick={onInspect} color="#4488ff">E</MBtn>
          <MBtn onClick={() => onMove("right")}>▶</MBtn>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          <MBtn onClick={() => onMove("down")}>▼</MBtn>
          <MBtn onClick={onHide} color="#8844ff">H</MBtn>
        </div>
        <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
          <MBtn onClick={onLiftUp} color="#ff3366">Q▲</MBtn>
          <MBtn onClick={onLiftDown} color="#00ff88">F▼</MBtn>
          <MBtn onClick={onShop} color="#aa8800">P</MBtn>
        </div>
      </div>

      <style>{`
        @keyframes anomaly-pulse {
          0%,100% { opacity:1; transform:scale(1); }
          50% { opacity:0.65; transform:scale(1.1); }
        }
      `}</style>
    </div>
  );
}

function MBtn({ onClick, children, color = "#446644" }: { onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button onClick={onClick} style={{ fontFamily: "'VT323', monospace", fontSize: 18, width: 36, height: 36,
      background: "#0a0a10", color, border: `1px solid ${color}44`, cursor: "pointer", lineHeight: 1, padding: 0 }}>
      {children}
    </button>
  );
}
