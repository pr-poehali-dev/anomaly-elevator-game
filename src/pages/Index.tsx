import { useState, useEffect, useCallback, useRef } from "react";

type Screen = "menu" | "game" | "settings";
type Direction = "up" | "down" | "left" | "right";

const MAP_COLS = 20;
const MAP_ROWS = 15;
const MAX_FLOOR = 8;

const T_FLOOR = 0;
const T_WALL = 1;
const T_DOOR = 2;
const T_ELEVATOR = 3;
const T_DESK = 4;
const T_CABINET = 5;
const T_WINDOW = 6;

const BASE_MAP: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
  [1,0,4,4,0,0,4,4,0,1,0,4,4,0,0,4,4,0,0,1],
  [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
  [1,0,4,4,0,0,4,4,0,1,0,4,4,0,0,4,4,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,5,0,0,0,1,1,0,0,0,5,0,0,0,0,1],
  [1,6,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,3,6,1],
  [1,6,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,6,1],
  [1,0,0,0,0,5,0,0,0,1,1,0,0,0,5,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,4,4,0,0,4,4,0,1,0,4,4,0,0,4,4,0,0,1],
  [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
  [1,0,4,4,0,0,4,4,0,1,0,4,4,0,0,4,4,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

interface Anomaly {
  x: number; y: number; id: number; visible: boolean; type: number;
}
interface Player { x: number; y: number; }
interface Settings { sfx: boolean; crt: boolean; scanlines: boolean; }

function generateAnomalies(floor: number): Anomaly[] {
  const count = Math.floor(Math.random() * 2) + 1;
  const walkable: {x: number; y: number}[] = [];
  for (let r = 1; r < MAP_ROWS - 1; r++) {
    for (let c = 1; c < MAP_COLS - 1; c++) {
      if (BASE_MAP[r][c] === T_FLOOR) walkable.push({ x: c, y: r });
    }
  }
  const shuffled = [...walkable].sort(() => Math.random() - 0.5);
  const anomalies: Anomaly[] = [];
  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    anomalies.push({
      x: shuffled[i].x, y: shuffled[i].y, id: i,
      visible: Math.random() > 0.5, type: Math.floor(Math.random() * 3),
    });
  }
  return anomalies;
}

const ANOMALY_SYMBOLS = ["👁", "💀", "🩸"];
const ANOMALY_COLORS = ["#ff3366", "#aa00ff", "#ff6600"];

function getTileStyle(tile: number, floor: number, cellSize: number): React.CSSProperties {
  const base: React.CSSProperties = { position: "absolute", width: cellSize, height: cellSize };
  switch (tile) {
    case T_WALL: return { ...base, background: `hsl(${200+floor*8},12%,${7+floor}%)`, borderRight: "1px solid rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.03)" };
    case T_FLOOR: return { ...base, background: `hsl(${190+floor*4},6%,${10+floor}%)` };
    case T_DOOR: return { ...base, background: "linear-gradient(180deg,#6b3a1a,#4a2010)", borderTop: "2px solid #8B4513" };
    case T_ELEVATOR: return { ...base, background: "linear-gradient(135deg,#1a3a6a,#0a1a3a)", border: "1px solid #4a90d9" };
    case T_DESK: return { ...base, background: `hsl(30,22%,${13+floor}%)`, borderTop: `2px solid hsl(30,28%,${19+floor}%)` };
    case T_CABINET: return { ...base, background: `hsl(210,16%,${13+floor}%)`, borderLeft: "1px solid rgba(100,150,200,0.15)" };
    case T_WINDOW: return { ...base, background: "linear-gradient(180deg,#0a1520,#050d18)", borderLeft: "2px solid #1a2a3a", borderRight: "2px solid #1a2a3a" };
    default: return { ...base, background: "#080810" };
  }
}

export default function Index() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [floor, setFloor] = useState(MAX_FLOOR);
  const [player, setPlayer] = useState<Player>({ x: 9, y: 7 });
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [message, setMessage] = useState("");
  const [floorAnomalyMap, setFloorAnomalyMap] = useState<Record<number, Anomaly[]>>({});
  const [settings, setSettings] = useState<Settings>({ sfx: true, crt: true, scanlines: true });
  const [flashing, setFlashing] = useState(false);
  const [win, setWin] = useState(false);
  const [foundAnomaly, setFoundAnomaly] = useState(false);

  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const stateRef = useRef({ floor, player, anomalies, foundAnomaly, floorAnomalyMap });

  useEffect(() => {
    stateRef.current = { floor, player, anomalies, foundAnomaly, floorAnomalyMap };
  }, [floor, player, anomalies, foundAnomaly, floorAnomalyMap]);

  const getAudio = useCallback(() => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as {AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext}).webkitAudioContext || AudioContext)();
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

  const playStep = useCallback(() => playTone(110 + Math.random() * 30, 0.07, "square", 0.05), [playTone]);
  const playLift = useCallback(() => { playTone(300, 0.12, "sawtooth", 0.1); setTimeout(() => playTone(240, 0.18, "sawtooth", 0.1), 130); }, [playTone]);
  const playAnomaly = useCallback(() => { playTone(80, 0.3, "sawtooth", 0.18); setTimeout(() => playTone(55, 0.5, "sawtooth", 0.18), 220); }, [playTone]);
  const playSuccess = useCallback(() => { [440, 550, 660, 880].forEach((f, i) => setTimeout(() => playTone(f, 0.15, "square", 0.13), i * 90)); }, [playTone]);

  const showMsg = useCallback((text: string, ms = 2500) => {
    setMessage(text);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMessage(""), ms);
  }, []);

  const goToFloor = useCallback((f: number, currentMap: Record<number, Anomaly[]>) => {
    const existing = currentMap[f];
    const anoms = existing ?? generateAnomalies(f);
    const newMap = existing ? currentMap : { ...currentMap, [f]: anoms };
    setFloor(f);
    setFloorAnomalyMap(newMap);
    setAnomalies(anoms);
    setPlayer({ x: 9, y: 7 });
    setFoundAnomaly(false);
    showMsg(anoms.length > 0 ? `⚠ ЭТАЖ ${f} — ФИКСИРУЮ АКТИВНОСТЬ` : `ЭТАЖ ${f} — ЧИСТО`, 2800);
  }, [showMsg]);

  const resetToTop = useCallback(() => {
    const anoms = generateAnomalies(MAX_FLOOR);
    const newMap = { [MAX_FLOOR]: anoms };
    setFloor(MAX_FLOOR);
    setFloorAnomalyMap(newMap);
    setAnomalies(anoms);
    setPlayer({ x: 9, y: 7 });
    setFoundAnomaly(false);
    showMsg(`ЭТАЖ ${MAX_FLOOR} — СБРОС ПРОТОКОЛА`, 2800);
  }, [showMsg]);

  const startGame = useCallback(() => {
    const anoms = generateAnomalies(MAX_FLOOR);
    const newMap = { [MAX_FLOOR]: anoms };
    setFloor(MAX_FLOOR); setFloorAnomalyMap(newMap); setAnomalies(anoms);
    setPlayer({ x: 9, y: 7 }); setWin(false); setFlashing(false);
    setFoundAnomaly(false); setMessage("");
    setScreen("game");
    showMsg(`ЭТАЖ ${MAX_FLOOR} — НАЧИНАЕМ МИССИЮ`, 3000);
  }, [showMsg]);

  const activateLift = useCallback((direction: "up" | "down") => {
    const { floor: curFloor, player: curPlayer, anomalies: curAnomalies, foundAnomaly: curFound, floorAnomalyMap: curMap } = stateRef.current;
    const liftCol = 17, liftRow = 7;
    if (Math.abs(curPlayer.x - liftCol) > 2 || Math.abs(curPlayer.y - liftRow) > 2) {
      showMsg("Подойди к лифту 🛗 (правая сторона)", 2000);
      return;
    }
    const hasAnomaly = curAnomalies.length > 0;

    if (direction === "down") {
      if (hasAnomaly && !curFound) {
        showMsg("❌ АНОМАЛИЯ НЕ ЗАФИКСИРОВАНА! Сброс...", 3000);
        setFlashing(true);
        playAnomaly();
        setTimeout(() => { setFlashing(false); resetToTop(); }, 1200);
        return;
      }
      if (curFloor <= 1) {
        playSuccess();
        setWin(true);
        return;
      }
      playLift();
      goToFloor(curFloor - 1, curMap);
    } else {
      if (!hasAnomaly) {
        showMsg("❌ НА ЭТАЖЕ ЧИСТО — вверх нельзя!", 3000);
        setFlashing(true);
        playAnomaly();
        setTimeout(() => { setFlashing(false); resetToTop(); }, 1200);
        return;
      }
      if (!curFound) {
        showMsg("Сначала найди аномалию — нажми [E]", 2500);
        return;
      }
      playLift();
      showMsg("✓ АНОМАЛИЯ ОТМЕЧЕНА — ЕДЕМ ВВЕРХ", 2000);
      const newF = Math.min(curFloor + 1, MAX_FLOOR);
      goToFloor(newF, curMap);
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
      showMsg(`⚠ АНОМАЛИЯ: ${ANOMALY_SYMBOLS[nearby.type]} — Используй ВВЕРХ [Q]`, 4000);
      setTimeout(() => setFlashing(false), 500);
      setAnomalies(prev => prev.map(a => a.id === nearby.id ? { ...a, visible: true } : a));
    } else {
      playTone(200, 0.06, "square", 0.05);
      showMsg("Здесь ничего нет.", 1500);
    }
  }, [playAnomaly, playTone, showMsg]);

  const movePlayer = useCallback((dir: Direction) => {
    setPlayer(prev => {
      let nx = prev.x, ny = prev.y;
      if (dir === "left") nx--;
      if (dir === "right") nx++;
      if (dir === "up") ny--;
      if (dir === "down") ny++;
      if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) return prev;
      const tile = BASE_MAP[ny][nx];
      if (tile === T_WALL || tile === T_DESK || tile === T_CABINET) return prev;
      playStep();
      return { x: nx, y: ny };
    });
  }, [playStep]);

  useEffect(() => {
    if (screen !== "game") return;
    const handler = (e: KeyboardEvent) => {
      if (win) return;
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
      if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") movePlayer("left");
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") movePlayer("right");
      if (e.key === "ArrowUp"    || e.key === "w" || e.key === "W") movePlayer("up");
      if (e.key === "ArrowDown"  || e.key === "s" || e.key === "S") movePlayer("down");
      if (e.key === "e" || e.key === "E" || e.key === " ") inspect();
      if (e.key === "q" || e.key === "Q") activateLift("up");
      if (e.key === "f" || e.key === "F") activateLift("down");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen, movePlayer, inspect, activateLift, win]);

  if (screen === "menu") return <MenuScreen onStart={startGame} onSettings={() => setScreen("settings")} />;
  if (screen === "settings") return <SettingsScreen settings={settings} setSettings={setSettings} onBack={() => setScreen("menu")} />;

  return (
    <GameScreen
      floor={floor} player={player} anomalies={anomalies} message={message}
      flashing={flashing} win={win} settings={settings} foundAnomaly={foundAnomaly}
      onMove={movePlayer} onInspect={inspect}
      onLiftUp={() => activateLift("up")} onLiftDown={() => activateLift("down")}
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
        backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 31px,rgba(0,255,136,0.03) 31px,rgba(0,255,136,0.03) 32px),repeating-linear-gradient(90deg,transparent,transparent 31px,rgba(0,255,136,0.03) 31px,rgba(0,255,136,0.03) 32px)",
      }} />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 120%, rgba(0,60,20,0.55) 0%, transparent 60%)",
      }} />

      <div style={{ fontSize: 7, color: "#ff336677", marginBottom: 12, letterSpacing: 6 }}>▓▓▓ ELEVATOR PROTOCOL v1.0 ▓▓▓</div>
      <h1 style={{
        fontSize: "clamp(28px,5vw,52px)", textAlign: "center", lineHeight: 1.4, marginBottom: 8,
        textShadow: "0 0 20px #00ff88, 0 0 50px #00ff4444",
      }}>ЛИФТ</h1>
      <div style={{ fontSize: 9, color: "#ff9900", marginBottom: 52, letterSpacing: 3, textShadow: "0 0 8px #ff990055" }}>
        ОХОТНИК ЗА АНОМАЛИЯМИ
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", marginBottom: 52 }}>
        <PixelBtn onClick={onStart} color="#00ff88">▶  НАЧАТЬ  ИГРУ</PixelBtn>
        <PixelBtn onClick={onSettings} color="#4488ff">⚙  НАСТРОЙКИ</PixelBtn>
      </div>

      <div style={{ fontSize: 6, color: "#335533", textAlign: "center", lineHeight: 2.8, minHeight: 60 }}>
        {blink ? "[ WASD / СТРЕЛКИ — ДВИЖЕНИЕ ]" : <span style={{ opacity: 0 }}>[ WASD / СТРЕЛКИ — ДВИЖЕНИЕ ]</span>}<br/>
        [ E / ПРОБЕЛ — ОСМОТР ]<br/>
        [ Q — ЛИФТ ВВЕРХ ]  [ F — ЛИФТ ВНИЗ ]
      </div>

      <div style={{ position: "absolute", bottom: 18, fontSize: 6, color: "#1a3322", textAlign: "center" }}>
        МИССИЯ: СПУСТИСЬ С ЭТАЖА 8 НА ЭТАЖ 1 ✦ НЕ ПОПАДИ В ЛОВУШКУ АНОМАЛИИ
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
  onMove, onInspect, onLiftUp, onLiftDown, onMenu, onRestart,
}: {
  floor: number; player: Player; anomalies: Anomaly[]; message: string;
  flashing: boolean; win: boolean; settings: Settings; foundAnomaly: boolean;
  onMove: (d: Direction) => void; onInspect: () => void;
  onLiftUp: () => void; onLiftDown: () => void;
  onMenu: () => void; onRestart: () => void;
}) {
  const [cellSize, setCellSize] = useState(32);

  useEffect(() => {
    const calc = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const panelW = 180;
      const availW = vw - panelW - 24;
      const availH = vh - 60 - 44 - 110;
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

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: flashing ? "#110003" : "#040407",
      display: "flex", flexDirection: "column",
      fontFamily: "'VT323', monospace",
      overflow: "hidden", userSelect: "none",
      transition: "background 0.15s",
    }}>
      {settings.crt && (
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 100,
          background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.78) 100%)",
        }} />
      )}
      {settings.scanlines && (
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 99,
          backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.13) 2px,rgba(0,0,0,0.13) 4px)",
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
            color: !hasAnomaly ? "#00ff88" : foundAnomaly ? "#ff9900" : "#ff3366",
            textShadow: "0 0 8px currentColor",
          }}>
            {!hasAnomaly ? "✓ ЭТАЖ ЧИСТ" : foundAnomaly ? "⚠ НАЙДЕНО" : "⚠ АНОМАЛИЯ"}
          </div>
          <div style={{ fontSize: 12, color: "#334433", marginTop: 2 }}>
            {!hasAnomaly ? "→ ЛИФТ ВНИЗ [F]" : foundAnomaly ? "→ ЛИФТ ВВЕРХ [Q]" : "→ ИССЛЕДУЙ [E]"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            {BASE_MAP.map((row, ry) =>
              row.map((tile, cx) => (
                <div key={`${ry}-${cx}`} style={{ ...getTileStyle(tile, floor, cellSize), left: cx * cellSize, top: ry * cellSize }}>
                  {tile === T_ELEVATOR && (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cellSize * 0.52 }}>🛗</div>
                  )}
                </div>
              ))
            )}

            {anomalies.filter(a => a.visible).map(a => (
              <div key={a.id} style={{
                position: "absolute",
                left: a.x * cellSize, top: a.y * cellSize,
                width: cellSize, height: cellSize,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: cellSize * 0.58, zIndex: 5,
                filter: `drop-shadow(0 0 6px ${ANOMALY_COLORS[a.type]})`,
                animation: "anomaly-pulse 1.4s ease-in-out infinite",
              }}>
                {ANOMALY_SYMBOLS[a.type]}
              </div>
            ))}

            {/* Player pixel sprite */}
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
          </div>
        </div>

        {/* SIDE PANEL */}
        <div style={{
          width: 180, background: "#07070c", borderLeft: "2px solid #12122a",
          display: "flex", flexDirection: "column", padding: 10, gap: 10, flexShrink: 0,
        }}>
          <div style={{ fontSize: 12, color: "#225533", letterSpacing: 2 }}>ЛИФТ</div>
          <button onClick={onLiftUp} style={{
            fontFamily: "'VT323', monospace", fontSize: 20, padding: "10px 0", lineHeight: 1.5,
            background: "#090c09", color: "#ff3366", border: "2px solid #ff3366",
            cursor: "pointer", textShadow: "0 0 8px #ff336677",
          }}>▲ ВВЕРХ<br/><span style={{ fontSize: 11, color: "#552233" }}>[Q]</span></button>

          <button onClick={onLiftDown} style={{
            fontFamily: "'VT323', monospace", fontSize: 20, padding: "10px 0", lineHeight: 1.5,
            background: "#090c09", color: "#00ff88", border: "2px solid #00ff88",
            cursor: "pointer", textShadow: "0 0 8px #00ff8877",
          }}>▼ ВНИЗ<br/><span style={{ fontSize: 11, color: "#224433" }}>[F]</span></button>

          <div style={{ fontSize: 12, color: "#225533", letterSpacing: 2, marginTop: 4 }}>ДЕЙСТВИЯ</div>
          <button onClick={onInspect} style={{
            fontFamily: "'VT323', monospace", fontSize: 18, padding: "10px 0", lineHeight: 1.5,
            background: "#090910", color: "#4488ff", border: "2px solid #4488ff",
            cursor: "pointer",
          }}>🔍 ОСМОТР<br/><span style={{ fontSize: 11, color: "#223355" }}>[E]</span></button>

          <div style={{ marginTop: "auto", fontSize: 12, color: "#1a2a1a", lineHeight: 2.2, borderTop: "1px solid #111", paddingTop: 8 }}>
            WASD / ↑↓←→<br/>движение<br/>E — осмотр<br/>Q — вверх<br/>F — вниз
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
            color: message.includes("❌") ? "#ff3366" : message.includes("⚠") ? "#ff9900" : message.includes("✓") ? "#00ff88" : "#888",
            textShadow: "0 0 6px currentColor",
            animation: "fadein 0.2s ease",
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
          <MBtn onClick={onInspect} color="#4488ff">●</MBtn>
          <MBtn onClick={() => onMove("right")}>▶</MBtn>
        </div>
        <MBtn onClick={() => onMove("down")}>▼</MBtn>
      </div>

      {win && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.93)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          zIndex: 200, fontFamily: "'Press Start 2P', monospace",
        }}>
          <div style={{ fontSize: 22, color: "#00ff88", textShadow: "0 0 30px #00ff88", marginBottom: 20 }}>🏆 МИССИЯ ВЫПОЛНЕНА</div>
          <div style={{ fontSize: 8, color: "#446644", marginBottom: 36, textAlign: "center", lineHeight: 3 }}>
            ВСЕ ЭТАЖИ ПРОВЕРЕНЫ<br/>АНОМАЛИИ ИЗОЛИРОВАНЫ<br/>ПРОТОКОЛ ЗАВЕРШЁН
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <PixelBtn onClick={onRestart} color="#00ff88">▶ СНОВА</PixelBtn>
            <PixelBtn onClick={onMenu} color="#4488ff">МЕНЮ</PixelBtn>
          </div>
        </div>
      )}

      <style>{`
        @keyframes anomaly-pulse {
          0%,100%{opacity:1;transform:scale(1)}
          50%{opacity:0.55;transform:scale(0.88)}
        }
        @keyframes fadein {
          from{opacity:0;transform:translateY(3px)}
          to{opacity:1;transform:translateY(0)}
        }
      `}</style>
    </div>
  );
}

function MBtn({ onClick, children, color }: { onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button onClick={onClick} style={{
      width: 42, height: 42,
      background: "#0c0c14", color: color ?? "#00ff88",
      border: `2px solid ${color ?? "#1a2a1a"}`,
      fontFamily: "'VT323', monospace", fontSize: 18,
      cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
      touchAction: "manipulation",
    }}>{children}</button>
  );
}