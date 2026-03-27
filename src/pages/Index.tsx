import { useState, useEffect, useCallback, useRef } from "react";

type Screen = "menu" | "game" | "settings";
type Direction = "up" | "down" | "left" | "right";

const MAP_COLS = 20;
const MAP_ROWS = 15;
const MAX_FLOOR = 8;
const MONSTER_DELAY = 15000; // ms before monster appears
const VISION_RADIUS = 4; // tiles player can see

const T_FLOOR = 0;
const T_WALL = 1;
const T_DOOR = 2;
const T_ELEVATOR = 3;
const T_DESK = 4;
const T_CABINET = 5;
const T_WINDOW = 6;

// Tile solidity — can't walk on these
const SOLID = new Set([T_WALL, T_DESK, T_CABINET, T_WINDOW]);

// More walls, complex corridors
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

interface Anomaly { x: number; y: number; id: number; visible: boolean; type: number; }
interface Player { x: number; y: number; hiding: boolean; }
interface Monster { x: number; y: number; active: boolean; }
interface Settings { sfx: boolean; crt: boolean; scanlines: boolean; }

function isWalkable(x: number, y: number): boolean {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return false;
  return !SOLID.has(BASE_MAP[y][x]);
}

function getWalkable(): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  for (let r = 1; r < MAP_ROWS - 1; r++)
    for (let c = 1; c < MAP_COLS - 1; c++)
      if (BASE_MAP[r][c] === T_FLOOR) result.push({ x: c, y: r });
  return result;
}

function generateAnomalies(): Anomaly[] {
  const count = Math.floor(Math.random() * 2) + 1;
  const walkable = getWalkable();
  const shuffled = [...walkable].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length)).map((pos, i) => ({
    x: pos.x, y: pos.y, id: i,
    visible: Math.random() > 0.4,
    type: Math.floor(Math.random() * 4),
  }));
}

// Simple BFS pathfinding for monster
function bfsPath(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } | null {
  const queue: { x: number; y: number; path: { x: number; y: number }[] }[] = [{ ...from, path: [] }];
  const visited = new Set<string>();
  visited.add(`${from.x},${from.y}`);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    for (const d of dirs) {
      const nx = cur.x + d.x, ny = cur.y + d.y;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!isWalkable(nx, ny)) continue;
      visited.add(key);
      const newPath = [...cur.path, { x: nx, y: ny }];
      if (nx === to.x && ny === to.y) return newPath[0] ?? null;
      queue.push({ x: nx, y: ny, path: newPath });
    }
  }
  return null;
}

// Compute visible tiles using raycasting (simple line-of-sight)
function computeVisible(player: Player, radius: number): Set<string> {
  const visible = new Set<string>();
  visible.add(`${player.x},${player.y}`);
  for (let angle = 0; angle < 360; angle += 3) {
    const rad = (angle * Math.PI) / 180;
    let px = player.x + 0.5, py = player.y + 0.5;
    for (let dist = 0; dist < radius; dist += 0.5) {
      px += Math.cos(rad) * 0.5;
      py += Math.sin(rad) * 0.5;
      const tx = Math.floor(px), ty = Math.floor(py);
      if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) break;
      visible.add(`${tx},${ty}`);
      if (SOLID.has(BASE_MAP[ty][tx])) break;
    }
  }
  return visible;
}

// Anomaly appearances: more varied, no emoji — pixel-art symbols
const ANOMALY_DATA = [
  { symbol: "✦", label: "СИГНАЛ",   color: "#ff3366", glow: "#ff003355" },
  { symbol: "◈", label: "ПОМЕХА",   color: "#ff6600", glow: "#ff440055" },
  { symbol: "⬡", label: "ИСТОЧНИК", color: "#cc00ff", glow: "#9900aa55" },
  { symbol: "⚿", label: "КОНТАКТ",  color: "#00ccff", glow: "#006688aa" },
];

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

export default function Index() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [floor, setFloor] = useState(MAX_FLOOR);
  const [player, setPlayer] = useState<Player>({ x: 9, y: 7, hiding: false });
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [message, setMessage] = useState("");
  const [floorAnomalyMap, setFloorAnomalyMap] = useState<Record<number, Anomaly[]>>({});
  const [settings, setSettings] = useState<Settings>({ sfx: true, crt: true, scanlines: true });
  const [flashing, setFlashing] = useState(false);
  const [win, setWin] = useState(false);
  const [foundAnomaly, setFoundAnomaly] = useState(false);
  const [monster, setMonster] = useState<Monster>({ x: 0, y: 0, active: false });
  const [dead, setDead] = useState(false);
  const [visibleTiles, setVisibleTiles] = useState<Set<string>>(new Set());

  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monsterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monsterMoveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const stateRef = useRef({ floor, player, anomalies, foundAnomaly, floorAnomalyMap, monster, dead });

  useEffect(() => {
    stateRef.current = { floor, player, anomalies, foundAnomaly, floorAnomalyMap, monster, dead };
  }, [floor, player, anomalies, foundAnomaly, floorAnomalyMap, monster, dead]);

  // Recompute visibility when player moves
  useEffect(() => {
    setVisibleTiles(computeVisible(player, VISION_RADIUS));
  }, [player.x, player.y]);

  const getAudio = useCallback(() => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || AudioContext)();
    }
    return audioCtx.current;
  }, []);

  const playTone = useCallback((freq: number, dur: number, type: OscillatorType = "square", vol = 0.12) => {
    if (!settings.sfx) return;
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
    } catch (_e) { /* ignore */ }
  }, [settings.sfx, getAudio]);

  const playStep = useCallback(() => playTone(100 + Math.random() * 20, 0.07, "square", 0.04), [playTone]);
  const playLift = useCallback(() => { playTone(280, 0.12, "sawtooth", 0.1); setTimeout(() => playTone(220, 0.18, "sawtooth", 0.1), 130); }, [playTone]);
  const playAnomaly = useCallback(() => { playTone(80, 0.3, "sawtooth", 0.18); setTimeout(() => playTone(55, 0.5, "sawtooth", 0.18), 220); }, [playTone]);
  const playSuccess = useCallback(() => { [440, 550, 660, 880].forEach((f, i) => setTimeout(() => playTone(f, 0.15, "square", 0.13), i * 90)); }, [playTone]);
  const playScream = useCallback(() => { playTone(120, 0.8, "sawtooth", 0.3); setTimeout(() => playTone(80, 0.6, "sawtooth", 0.25), 400); }, [playTone]);

  const showMsg = useCallback((text: string, ms = 2500) => {
    setMessage(text);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMessage(""), ms);
  }, []);

  const killMonsterTimers = useCallback(() => {
    if (monsterTimer.current) { clearTimeout(monsterTimer.current); monsterTimer.current = null; }
    if (monsterMoveTimer.current) { clearInterval(monsterMoveTimer.current); monsterMoveTimer.current = null; }
  }, []);

  const spawnMonster = useCallback(() => {
    const walkable = getWalkable();
    const { player: curPlayer } = stateRef.current;
    // Spawn far from player
    const far = walkable.filter(p => Math.abs(p.x - curPlayer.x) + Math.abs(p.y - curPlayer.y) > 8);
    const pos = far.length ? far[Math.floor(Math.random() * far.length)] : walkable[0];
    setMonster({ x: pos.x, y: pos.y, active: true });
    showMsg("⚠ ДАТЧИК ДВИЖЕНИЯ — В ЗДАНИИ ЧТО-ТО ЕСТЬ", 3000);
    playAnomaly();

    // Monster moves every 800ms
    monsterMoveTimer.current = setInterval(() => {
      const { player: p, monster: m, dead: isDead } = stateRef.current;
      if (isDead || !m.active) return;
      // If player hiding in cabinet — monster can't find
      if (p.hiding) return;
      // If player on elevator tile — monster can't attack
      if (BASE_MAP[p.y][p.x] === T_ELEVATOR) return;

      const next = bfsPath(m, p);
      if (!next) return;
      setMonster(prev => ({ ...prev, x: next.x, y: next.y }));
      // Check catch
      if (next.x === p.x && next.y === p.y) {
        setDead(true);
        playScream();
        showMsg("☠ СХВАЧЕН! НАЖМИ R ДЛЯ РЕСТАРТА", 99999);
      }
    }, 800);
  }, [showMsg, playAnomaly, playScream]);

  const startMonsterTimer = useCallback(() => {
    killMonsterTimers();
    monsterTimer.current = setTimeout(() => spawnMonster(), MONSTER_DELAY);
  }, [killMonsterTimers, spawnMonster]);

  const goToFloor = useCallback((f: number, currentMap: Record<number, Anomaly[]>) => {
    killMonsterTimers();
    setMonster({ x: 0, y: 0, active: false });
    const existing = currentMap[f];
    const anoms = existing ?? generateAnomalies();
    const newMap = existing ? currentMap : { ...currentMap, [f]: anoms };
    setFloor(f);
    setFloorAnomalyMap(newMap);
    setAnomalies(anoms);
    setPlayer({ x: 9, y: 7, hiding: false });
    setFoundAnomaly(false);
    showMsg(anoms.length > 0 ? `▶ ЭТАЖ ${f} — ФИКСИРУЮ АКТИВНОСТЬ` : `▶ ЭТАЖ ${f} — ЧИСТО`, 2800);
    startMonsterTimer();
  }, [showMsg, killMonsterTimers, startMonsterTimer]);

  const resetToTop = useCallback(() => {
    killMonsterTimers();
    setMonster({ x: 0, y: 0, active: false });
    const anoms = generateAnomalies();
    const newMap = { [MAX_FLOOR]: anoms };
    setFloor(MAX_FLOOR);
    setFloorAnomalyMap(newMap);
    setAnomalies(anoms);
    setPlayer({ x: 9, y: 7, hiding: false });
    setFoundAnomaly(false);
    showMsg(`СБРОС — ЭТАЖ ${MAX_FLOOR}`, 2800);
    startMonsterTimer();
  }, [showMsg, killMonsterTimers, startMonsterTimer]);

  const startGame = useCallback(() => {
    killMonsterTimers();
    const anoms = generateAnomalies();
    const newMap = { [MAX_FLOOR]: anoms };
    setFloor(MAX_FLOOR); setFloorAnomalyMap(newMap); setAnomalies(anoms);
    setPlayer({ x: 9, y: 7, hiding: false }); setWin(false); setFlashing(false);
    setFoundAnomaly(false); setMessage(""); setDead(false);
    setMonster({ x: 0, y: 0, active: false });
    setScreen("game");
    showMsg(`▶ ЭТАЖ ${MAX_FLOOR} — НАЧИНАЕМ МИССИЮ`, 3000);
    setTimeout(() => startMonsterTimer(), 100);
  }, [showMsg, killMonsterTimers, startMonsterTimer]);

  // ЛИФТ ВВЕРХ = есть аномалия, ЛИФТ ВНИЗ = чисто
  const activateLift = useCallback((direction: "up" | "down") => {
    const { floor: curFloor, player: curPlayer, anomalies: curAnomalies, foundAnomaly: curFound, floorAnomalyMap: curMap } = stateRef.current;
    const liftCol = 17, liftRow = 7;
    if (Math.abs(curPlayer.x - liftCol) > 2 || Math.abs(curPlayer.y - liftRow) > 2) {
      showMsg("Подойди к лифту (правая сторона)", 2000);
      return;
    }
    const hasAnomaly = curAnomalies.length > 0;

    if (direction === "up") {
      // ВВЕРХ — только если есть аномалия и она найдена
      if (!hasAnomaly) {
        showMsg("❌ ЭТАЖ ЧИСТ — нельзя ехать вверх! Жми ВНИЗ", 3000);
        setFlashing(true); playAnomaly();
        setTimeout(() => { setFlashing(false); resetToTop(); }, 1200);
        return;
      }
      if (!curFound) {
        showMsg("Сначала найди аномалию — нажми [E]", 2500);
        return;
      }
      // Went up from floor 8 — report and finish
      if (curFloor >= MAX_FLOOR) {
        playSuccess(); setWin(true); return;
      }
      playLift();
      showMsg("✓ АНОМАЛИЯ ОТМЕЧЕНА — ЕДЕМ ВВЕРХ", 2000);
      goToFloor(curFloor + 1, curMap);
    } else {
      // ВНИЗ — только если нет аномалии или она найдена и чисто
      if (hasAnomaly && !curFound) {
        showMsg("❌ АНОМАЛИЯ НЕ ЗАФИКСИРОВАНА! Сброс...", 3000);
        setFlashing(true); playAnomaly();
        setTimeout(() => { setFlashing(false); resetToTop(); }, 1200);
        return;
      }
      if (curFloor <= 1) {
        playSuccess(); setWin(true); return;
      }
      playLift();
      goToFloor(curFloor - 1, curMap);
    }
  }, [showMsg, playAnomaly, playLift, playSuccess, goToFloor, resetToTop]);

  const inspect = useCallback(() => {
    const { player: curPlayer, anomalies: curAnomalies } = stateRef.current;
    const nearby = curAnomalies.find(a =>
      Math.abs(a.x - curPlayer.x) <= 1 && Math.abs(a.y - curPlayer.y) <= 1
    );
    if (nearby) {
      setFoundAnomaly(true);
      playAnomaly();
      setFlashing(true);
      showMsg(`▶ АНОМАЛИЯ: ${ANOMALY_DATA[nearby.type].label} — Жми ВВЕРХ [Q]`, 4000);
      setTimeout(() => setFlashing(false), 500);
      setAnomalies(prev => prev.map(a => a.id === nearby.id ? { ...a, visible: true } : a));
    } else {
      playTone(200, 0.06, "square", 0.05);
      showMsg("Здесь ничего нет.", 1500);
    }
  }, [playAnomaly, playTone, showMsg]);

  const movePlayer = useCallback((dir: Direction) => {
    const { dead: isDead, player: curPlayer } = stateRef.current;
    if (isDead) return;
    // Unhide when moving
    setPlayer(prev => {
      let nx = prev.x, ny = prev.y;
      if (dir === "left") nx--;
      if (dir === "right") nx++;
      if (dir === "up") ny--;
      if (dir === "down") ny++;
      if (!isWalkable(nx, ny)) return prev;
      playStep();
      return { x: nx, y: ny, hiding: false };
    });
    // Check monster catch after move
    setTimeout(() => {
      const { player: p, monster: m, dead: isDead2 } = stateRef.current;
      if (isDead2 || !m.active) return;
      if (p.hiding || BASE_MAP[p.y][p.x] === T_ELEVATOR) return;
      if (m.x === p.x && m.y === p.y) {
        setDead(true);
        playScream();
        showMsg("☠ СХВАЧЕН! Нажми R для рестарта", 99999);
      }
    }, 50);
  }, [playStep, playScream, showMsg]);

  const hideInCabinet = useCallback(() => {
    const { player: curPlayer, dead: isDead } = stateRef.current;
    if (isDead) return;
    const nearCabinet = [
      { x: curPlayer.x - 1, y: curPlayer.y },
      { x: curPlayer.x + 1, y: curPlayer.y },
      { x: curPlayer.x, y: curPlayer.y - 1 },
      { x: curPlayer.x, y: curPlayer.y + 1 },
    ].some(p => p.x >= 0 && p.y >= 0 && p.x < MAP_COLS && p.y < MAP_ROWS && BASE_MAP[p.y][p.x] === T_CABINET);

    if (nearCabinet) {
      setPlayer(prev => ({ ...prev, hiding: !prev.hiding }));
      showMsg(stateRef.current.player.hiding ? "Вышел из укрытия" : "🫥 Спрятался в шкафу — монстр не найдёт", 2500);
    } else {
      showMsg("Нет шкафа рядом", 1200);
    }
  }, [showMsg]);

  useEffect(() => {
    if (screen !== "game") return;
    const handler = (e: KeyboardEvent) => {
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
      const { dead: isDead } = stateRef.current;
      if (e.key === "r" || e.key === "R") { startGame(); return; }
      if (isDead) return;
      if (win) return;
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

  useEffect(() => () => killMonsterTimers(), [killMonsterTimers]);

  if (screen === "menu") return <MenuScreen onStart={startGame} onSettings={() => setScreen("settings")} />;
  if (screen === "settings") return <SettingsScreen settings={settings} setSettings={setSettings} onBack={() => setScreen("menu")} />;

  return (
    <GameScreen
      floor={floor} player={player} anomalies={anomalies} message={message}
      flashing={flashing} win={win} settings={settings} foundAnomaly={foundAnomaly}
      monster={monster} dead={dead} visibleTiles={visibleTiles}
      onMove={movePlayer} onInspect={inspect}
      onLiftUp={() => activateLift("up")} onLiftDown={() => activateLift("down")}
      onHide={hideInCabinet}
      onMenu={() => setScreen("menu")} onRestart={startGame}
    />
  );
}

function MenuScreen({ onStart, onSettings }: { onStart: () => void; onSettings: () => void }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 550);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Press Start 2P', monospace", color: "#00ff88",
      position: "relative", overflow: "hidden", userSelect: "none",
    }}>
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 31px,rgba(0,255,136,0.03) 31px,rgba(0,255,136,0.03) 32px)",
      }} />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 120%, rgba(0,60,20,0.55) 0%, transparent 60%)",
      }} />

      <div style={{ fontSize: 7, color: "#ff336677", marginBottom: 12, letterSpacing: 6 }}>▓▓▓ ELEVATOR PROTOCOL v2.0 ▓▓▓</div>
      <h1 style={{
        fontSize: "clamp(28px,5vw,52px)", textAlign: "center", lineHeight: 1.4, marginBottom: 8,
        textShadow: "0 0 20px #00ff88, 0 0 50px #00ff4444",
      }}>ЛИФТ</h1>
      <div style={{ fontSize: 9, color: "#ff9900", marginBottom: 44, letterSpacing: 3, textShadow: "0 0 8px #ff990055" }}>
        ОХОТНИК ЗА АНОМАЛИЯМИ
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", marginBottom: 44 }}>
        <PixelBtn onClick={onStart} color="#00ff88">▶  НАЧАТЬ  ИГРУ</PixelBtn>
        <PixelBtn onClick={onSettings} color="#4488ff">⚙  НАСТРОЙКИ</PixelBtn>
      </div>

      <div style={{ fontSize: 6, color: "#335533", textAlign: "center", lineHeight: 2.8, minHeight: 60 }}>
        {blink ? "[ WASD / СТРЕЛКИ — ДВИЖЕНИЕ ]" : <span style={{ opacity: 0 }}>X</span>}<br/>
        [ E — ОСМОТР ]  [ H — ШКАФ ]<br/>
        [ Q — ЛИФТ ВВЕРХ (аномалия) ]<br/>
        [ F — ЛИФТ ВНИЗ (чисто) ]
      </div>

      <div style={{ position: "absolute", bottom: 18, fontSize: 6, color: "#1a3322", textAlign: "center" }}>
        МИССИЯ: СПУСТИСЬ С ЭТАЖА 8 НА ЭТАЖ 1 ✦ ИЗБЕГАЙ МОНСТРА ✦ ПРЯЧЬСЯ В ШКАФАХ
      </div>
    </div>
  );
}

function SettingsScreen({ settings, setSettings, onBack }: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  onBack: () => void;
}) {
  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Press Start 2P', monospace", color: "#00ff88",
    }}>
      <div style={{ fontSize: 7, color: "#336644", marginBottom: 12, letterSpacing: 4 }}>▓▓▓ НАСТРОЙКИ ▓▓▓</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 300, marginBottom: 44 }}>
        {([ ["ЗВУКИ", "sfx"], ["CRT ЭФФЕКТ", "crt"], ["СКАНЛАЙНЫ", "scanlines"] ] as [string, keyof Settings][]).map(([label, key]) => (
          <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 8, color: "#aaa" }}>{label}</span>
            <button onClick={() => setSettings(s => ({ ...s, [key]: !s[key] }))} style={{
              fontFamily: "'Press Start 2P', monospace", fontSize: 8, padding: "7px 14px",
              background: settings[key] ? "#00ff88" : "#111",
              color: settings[key] ? "#000" : "#444",
              border: `2px solid ${settings[key] ? "#00ff88" : "#333"}`,
              cursor: "pointer",
            }}>{settings[key] ? "ВКЛ" : "ВЫКЛ"}</button>
          </div>
        ))}
      </div>
      <PixelBtn onClick={onBack} color="#ff9900">← НАЗАД</PixelBtn>
    </div>
  );
}

function PixelBtn({ onClick, children, color }: { onClick: () => void; children: React.ReactNode; color: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: "'Press Start 2P', monospace", fontSize: 10, padding: "13px 28px",
        background: hover ? color : "transparent", color: hover ? "#000" : color,
        border: `3px solid ${color}`, cursor: "pointer",
        boxShadow: hover ? `0 0 22px ${color}66` : "none",
        transition: "all 0.08s", letterSpacing: 1,
      }}
    >{children}</button>
  );
}

function GameScreen({
  floor, player, anomalies, message, flashing, win, settings, foundAnomaly,
  monster, dead, visibleTiles,
  onMove, onInspect, onLiftUp, onLiftDown, onHide, onMenu, onRestart,
}: {
  floor: number; player: Player; anomalies: Anomaly[]; message: string;
  flashing: boolean; win: boolean; settings: Settings; foundAnomaly: boolean;
  monster: Monster; dead: boolean; visibleTiles: Set<string>;
  onMove: (d: Direction) => void; onInspect: () => void;
  onLiftUp: () => void; onLiftDown: () => void; onHide: () => void;
  onMenu: () => void; onRestart: () => void;
}) {
  const [cellSize, setCellSize] = useState(32);

  useEffect(() => {
    const calc = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const panelW = 190;
      const availW = vw - panelW - 24;
      const availH = vh - 60 - 44 - 100;
      const cs = Math.floor(Math.min(availW / MAP_COLS, availH / MAP_ROWS));
      setCellSize(Math.max(14, Math.min(cs, 40)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const mapW = cellSize * MAP_COLS;
  const mapH = cellSize * MAP_ROWS;
  const hasAnomaly = anomalies.length > 0;
  const monsterVisible = monster.active && visibleTiles.has(`${monster.x},${monster.y}`);

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: dead ? "#110000" : flashing ? "#110003" : "#040407",
      display: "flex", flexDirection: "column",
      fontFamily: "'VT323', monospace",
      overflow: "hidden", userSelect: "none",
      transition: "background 0.15s",
    }}>
      {settings.crt && (
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 100,
          background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.82) 100%)",
        }} />
      )}
      {settings.scanlines && (
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 99,
          backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.14) 2px,rgba(0,0,0,0.14) 4px)",
        }} />
      )}

      {/* HUD */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 16px", background: "#07070c",
        borderBottom: "2px solid #12122a", flexShrink: 0, minHeight: 56,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "#446644", letterSpacing: 1 }}>ЭТАЖ</div>
            <div style={{ fontSize: 34, color: "#fff", lineHeight: 1, textShadow: "0 0 12px #ff990088" }}>{floor}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column-reverse", gap: 2 }}>
            {Array.from({ length: MAX_FLOOR }, (_, i) => i + 1).map(f => (
              <div key={f} style={{
                width: 10, height: 4,
                background: f > floor ? "#1a1a1a" : f === floor ? "#ff9900" : "#00aa55",
                boxShadow: f === floor ? "0 0 8px #ff9900" : "none",
                transition: "all 0.3s",
              }} />
            ))}
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: 16, letterSpacing: 2,
            color: dead ? "#ff0000" : !hasAnomaly ? "#00ff88" : foundAnomaly ? "#ff9900" : "#ff3366",
            textShadow: "0 0 8px currentColor",
          }}>
            {dead ? "☠ МЁ Р Т В" : !hasAnomaly ? "✓ ЭТАЖ ЧИСТ" : foundAnomaly ? "◈ НАЙДЕНО" : "✦ АНОМАЛИЯ"}
          </div>
          <div style={{ fontSize: 12, color: "#334433", marginTop: 2 }}>
            {dead ? "R — рестарт" : !hasAnomaly ? "→ ВНИЗ [F]" : foundAnomaly ? "→ ВВЕРХ [Q]" : "→ ОСМОТР [E]"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {monster.active && !dead && (
            <div style={{ fontSize: 12, color: "#ff0000", textShadow: "0 0 8px #ff0000", animation: "anomaly-pulse 0.8s ease-in-out infinite" }}>
              ◉ МОНСТР
            </div>
          )}
          {player.hiding && (
            <div style={{ fontSize: 12, color: "#4488ff", textShadow: "0 0 6px #4488ff" }}>🫥 СКРЫТ</div>
          )}
          <div style={{ fontSize: 12, color: "#223322", textAlign: "right" }}>ЦЕЛЬ:<br/>ЭТАЖ 1</div>
          <button onClick={onMenu} style={{
            fontFamily: "'VT323', monospace", fontSize: 15,
            background: "transparent", color: "#333", border: "1px solid #222",
            padding: "3px 10px", cursor: "pointer",
          }}>МЕНЮ</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
          <div style={{
            width: mapW, height: mapH, position: "relative", flexShrink: 0,
            boxShadow: "0 0 0 2px #12122a, 0 0 40px rgba(0,0,0,0.9)",
          }}>
            {/* Tiles */}
            {BASE_MAP.map((row, ry) =>
              row.map((tile, cx) => {
                const isVisible = visibleTiles.has(`${cx},${ry}`);
                const tc = getTileColor(tile, floor);
                const isElevator = tile === T_ELEVATOR;
                return (
                  <div key={`${ry}-${cx}`} style={{
                    position: "absolute",
                    left: cx * cellSize, top: ry * cellSize,
                    width: cellSize, height: cellSize,
                    background: isVisible ? tc.bg : "#010102",
                    borderRight: tc.border && isVisible ? `1px solid ${tc.border}` : undefined,
                    borderBottom: tc.border && isVisible ? `1px solid ${tc.border}` : undefined,
                    transition: "background 0.2s",
                  }}>
                    {isElevator && isVisible && (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cellSize * 0.52 }}>🛗</div>
                    )}
                    {tile === T_CABINET && isVisible && (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cellSize * 0.4, color: "#446" }}>▣</div>
                    )}
                    {tile === T_DOOR && isVisible && (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cellSize * 0.45, color: "#8B4513" }}>▬</div>
                    )}
                    {/* Fog overlay for partially visible */}
                    {!isVisible && (
                      <div style={{ position: "absolute", inset: 0, background: "#010102" }} />
                    )}
                  </div>
                );
              })
            )}

            {/* Anomalies — only if visible */}
            {anomalies.filter(a => a.visible && visibleTiles.has(`${a.x},${a.y}`)).map(a => {
              const ad = ANOMALY_DATA[a.type];
              return (
                <div key={a.id} style={{
                  position: "absolute",
                  left: a.x * cellSize, top: a.y * cellSize,
                  width: cellSize, height: cellSize,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: cellSize * 0.7, color: ad.color,
                  textShadow: `0 0 8px ${ad.color}, 0 0 20px ${ad.glow}`,
                  zIndex: 5,
                  animation: "anomaly-pulse 1.4s ease-in-out infinite",
                  fontFamily: "monospace",
                }}>
                  {ad.symbol}
                </div>
              );
            })}

            {/* Monster */}
            {monsterVisible && (
              <div style={{
                position: "absolute",
                left: monster.x * cellSize, top: monster.y * cellSize,
                width: cellSize, height: cellSize,
                zIndex: 8, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width={cellSize * 0.8} height={cellSize * 0.9} viewBox="0 0 12 14" style={{ imageRendering: "pixelated" }}>
                  {/* Monster body — dark red creature */}
                  <rect x="2" y="1" width="8" height="6" fill="#660000" />
                  <rect x="1" y="2" width="10" height="4" fill="#880000" />
                  {/* Eyes — glowing white */}
                  <rect x="3" y="3" width="2" height="2" fill="#ff0000" />
                  <rect x="7" y="3" width="2" height="2" fill="#ff0000" />
                  <rect x="3" y="3" width="1" height="1" fill="#ffffff" />
                  <rect x="7" y="3" width="1" height="1" fill="#ffffff" />
                  {/* Mouth */}
                  <rect x="4" y="5" width="4" height="1" fill="#ff3300" />
                  <rect x="4" y="6" width="1" height="1" fill="#ff3300" />
                  <rect x="7" y="6" width="1" height="1" fill="#ff3300" />
                  {/* Body */}
                  <rect x="2" y="7" width="8" height="5" fill="#550000" />
                  <rect x="1" y="8" width="2" height="3" fill="#440000" />
                  <rect x="9" y="8" width="2" height="3" fill="#440000" />
                  {/* Legs */}
                  <rect x="3" y="12" width="2" height="2" fill="#330000" />
                  <rect x="7" y="12" width="2" height="2" fill="#330000" />
                  {/* Claws */}
                  <rect x="0" y="9" width="1" height="2" fill="#660000" />
                  <rect x="11" y="9" width="1" height="2" fill="#660000" />
                </svg>
              </div>
            )}

            {/* Player */}
            {!player.hiding && (
              <div style={{
                position: "absolute",
                left: player.x * cellSize, top: player.y * cellSize,
                width: cellSize, height: cellSize,
                zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width={cellSize * 0.75} height={cellSize * 0.88} viewBox="0 0 12 14" style={{ imageRendering: "pixelated" }}>
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
              </div>
            )}
            {/* Hiding indicator */}
            {player.hiding && (
              <div style={{
                position: "absolute",
                left: player.x * cellSize, top: player.y * cellSize,
                width: cellSize, height: cellSize,
                zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: cellSize * 0.55, opacity: 0.5,
              }}>👤</div>
            )}

            {/* Win overlay */}
            {win && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(0,20,10,0.92)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                zIndex: 50, fontFamily: "'Press Start 2P', monospace",
              }}>
                <div style={{ fontSize: 20, color: "#00ff88", textShadow: "0 0 30px #00ff88", marginBottom: 20 }}>ПОБЕДА!</div>
                <div style={{ fontSize: 9, color: "#446644", marginBottom: 30 }}>ВСЕ ЭТАЖИ ПРОЙДЕНЫ</div>
                <PixelBtn onClick={onRestart} color="#00ff88">▶ СНОВА</PixelBtn>
              </div>
            )}
            {dead && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(20,0,0,0.92)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                zIndex: 50, fontFamily: "'Press Start 2P', monospace",
              }}>
                <div style={{ fontSize: 20, color: "#ff0000", textShadow: "0 0 30px #ff0000", marginBottom: 20 }}>☠ КОНЕЦ</div>
                <div style={{ fontSize: 9, color: "#663333", marginBottom: 30 }}>МОНСТР ПОЙМАЛ ВАС</div>
                <PixelBtn onClick={onRestart} color="#ff3366">▶ СНОВА [R]</PixelBtn>
              </div>
            )}
          </div>
        </div>

        {/* SIDE PANEL */}
        <div style={{
          width: 190, background: "#07070c", borderLeft: "2px solid #12122a",
          display: "flex", flexDirection: "column", padding: 10, gap: 10, flexShrink: 0,
        }}>
          <div style={{ fontSize: 12, color: "#225533", letterSpacing: 2 }}>ЛИФТ</div>
          <button onClick={onLiftUp} style={{
            fontFamily: "'VT323', monospace", fontSize: 20, padding: "10px 0", lineHeight: 1.5,
            background: "#090c09", color: "#ff3366", border: "2px solid #ff3366",
            cursor: "pointer", textShadow: "0 0 8px #ff336677",
          }}>▲ ВВЕРХ<br/><span style={{ fontSize: 11, color: "#552233" }}>[Q] АНОМАЛИЯ</span></button>

          <button onClick={onLiftDown} style={{
            fontFamily: "'VT323', monospace", fontSize: 20, padding: "10px 0", lineHeight: 1.5,
            background: "#090c09", color: "#00ff88", border: "2px solid #00ff88",
            cursor: "pointer", textShadow: "0 0 8px #00ff8877",
          }}>▼ ВНИЗ<br/><span style={{ fontSize: 11, color: "#224433" }}>[F] ЧИСТО</span></button>

          <div style={{ fontSize: 12, color: "#225533", letterSpacing: 2, marginTop: 4 }}>ДЕЙСТВИЯ</div>
          <button onClick={onInspect} style={{
            fontFamily: "'VT323', monospace", fontSize: 18, padding: "8px 0", lineHeight: 1.5,
            background: "#090910", color: "#4488ff", border: "2px solid #4488ff",
            cursor: "pointer",
          }}>◈ ОСМОТР [E]</button>

          <button onClick={onHide} style={{
            fontFamily: "'VT323', monospace", fontSize: 18, padding: "8px 0", lineHeight: 1.5,
            background: "#090910", color: "#8844ff", border: "2px solid #8844ff",
            cursor: "pointer",
          }}>🫥 ШКАФ [H]</button>

          <div style={{ marginTop: "auto", fontSize: 11, color: "#1a2a1a", lineHeight: 2.2, borderTop: "1px solid #111", paddingTop: 8 }}>
            WASD — движение<br/>E — осмотр<br/>H — шкаф<br/>Q — вверх<br/>F — вниз<br/>R — рестарт
          </div>
        </div>
      </div>

      {/* MESSAGE BAR */}
      <div style={{
        height: 44, background: "#05050a", borderTop: "2px solid #12122a",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {message && (
          <div style={{
            fontSize: 20,
            color: message.includes("❌") || message.includes("☠") ? "#ff3366" : message.includes("▶") || message.includes("✓") || message.includes("◈") ? "#ff9900" : "#888",
            textShadow: "0 0 6px currentColor",
          }}>{message}</div>
        )}
      </div>

      {/* MOBILE D-PAD */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 3, padding: "6px 0 8px", background: "#05050a",
        borderTop: "1px solid #111", flexShrink: 0,
      }}>
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
          <MBtn onClick={onLiftUp} color="#ff3366">▲Q</MBtn>
          <MBtn onClick={onLiftDown} color="#00ff88">▼F</MBtn>
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
    <button onClick={onClick} style={{
      fontFamily: "'VT323', monospace", fontSize: 18, width: 36, height: 36,
      background: "#0a0a10", color, border: `1px solid ${color}44`,
      cursor: "pointer", lineHeight: 1, padding: 0,
    }}>{children}</button>
  );
}
