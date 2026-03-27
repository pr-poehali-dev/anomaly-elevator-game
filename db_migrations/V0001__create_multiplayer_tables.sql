
CREATE TABLE IF NOT EXISTS t_p24469661_anomaly_elevator_gam.rooms (
  id TEXT PRIMARY KEY,
  floor INTEGER NOT NULL DEFAULT 8,
  anomalies JSONB NOT NULL DEFAULT '[]',
  found_anomaly BOOLEAN NOT NULL DEFAULT FALSE,
  monster JSONB NOT NULL DEFAULT '{"x":0,"y":0,"active":false}',
  step_count INTEGER NOT NULL DEFAULT 0,
  cleared_floors JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p24469661_anomaly_elevator_gam.players (
  id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'АГЕНТ',
  x INTEGER NOT NULL DEFAULT 9,
  y INTEGER NOT NULL DEFAULT 7,
  hiding BOOLEAN NOT NULL DEFAULT FALSE,
  dead BOOLEAN NOT NULL DEFAULT FALSE,
  color TEXT NOT NULL DEFAULT '#00ff88',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, room_id)
);

CREATE INDEX IF NOT EXISTS players_room_idx ON t_p24469661_anomaly_elevator_gam.players(room_id);
