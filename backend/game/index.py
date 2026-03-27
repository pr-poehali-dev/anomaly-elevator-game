"""
Game multiplayer API: create/join rooms, sync player positions, room state.
GET  /?action=room&room_id=X           — get full room state
POST /?action=create                   — create room, returns room_id + player_id
POST /?action=join                     — join room by room_id
POST /?action=move                     — update player position
POST /?action=room_state               — update shared room state (floor, monster, anomalies)
POST /?action=heartbeat                — keep player alive (ping)
"""

import json
import os
import random
import string
import time
from datetime import datetime, timezone

import psycopg2

SCHEMA = "t_p24469661_anomaly_elevator_gam"
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}
PLAYER_COLORS = ["#00ff88", "#4488ff", "#ff9900", "#ff3366", "#cc00ff", "#00ccff"]

MAP_COLS, MAP_ROWS = 20, 15
T_FLOOR = 0
SOLID = {1, 4, 5, 6}
BASE_MAP = [
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
]


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def rand_id(n=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def get_walkable():
    result = []
    for r in range(1, MAP_ROWS - 1):
        for c in range(1, MAP_COLS - 1):
            if BASE_MAP[r][c] == T_FLOOR:
                result.append({"x": c, "y": r})
    return result


def generate_anomalies():
    count = random.randint(1, 2)
    walkable = get_walkable()
    random.shuffle(walkable)
    return [
        {"x": w["x"], "y": w["y"], "id": i,
         "visible": random.random() > 0.4,
         "type": random.randint(0, 3)}
        for i, w in enumerate(walkable[:count])
    ]


def clean_old_rooms(cur):
    cur.execute(
        f"UPDATE {SCHEMA}.players SET updated_at = NOW() WHERE FALSE"
    )


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    action = params.get("action", "room")
    body = {}
    if event.get("body"):
        body = json.loads(event["body"])

    conn = get_conn()
    cur = conn.cursor()

    try:
        if action == "room" and method == "GET":
            room_id = params.get("room_id", "")
            player_id = params.get("player_id", "")
            cur.execute(
                f"SELECT floor, anomalies, found_anomaly, monster, step_count, cleared_floors, updated_at FROM {SCHEMA}.rooms WHERE id = %s",
                (room_id,)
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": CORS, "body": json.dumps({"error": "room not found"})}
            # Get players alive in last 5s
            cur.execute(
                f"SELECT id, name, x, y, hiding, dead, color FROM {SCHEMA}.players WHERE room_id = %s AND updated_at > NOW() - INTERVAL '5 seconds'",
                (room_id,)
            )
            players = [{"id": r[0], "name": r[1], "x": r[2], "y": r[3], "hiding": r[4], "dead": r[5], "color": r[6]} for r in cur.fetchall()]
            return {
                "statusCode": 200,
                "headers": CORS,
                "body": json.dumps({
                    "floor": row[0],
                    "anomalies": row[1],
                    "foundAnomaly": row[2],
                    "monster": row[3],
                    "stepCount": row[4],
                    "clearedFloors": row[5],
                    "players": players,
                    "me": player_id,
                })
            }

        elif action == "create" and method == "POST":
            room_id = rand_id(4)
            player_id = rand_id(8)
            name = body.get("name", "АГЕНТ-1")
            anoms = generate_anomalies()
            cur.execute(
                f"INSERT INTO {SCHEMA}.rooms (id, floor, anomalies) VALUES (%s, 8, %s)",
                (room_id, json.dumps(anoms))
            )
            cur.execute(
                f"INSERT INTO {SCHEMA}.players (id, room_id, name, x, y, color) VALUES (%s, %s, %s, 9, 7, %s)",
                (player_id, room_id, name, PLAYER_COLORS[0])
            )
            conn.commit()
            return {
                "statusCode": 200,
                "headers": CORS,
                "body": json.dumps({"roomId": room_id, "playerId": player_id, "color": PLAYER_COLORS[0]})
            }

        elif action == "join" and method == "POST":
            room_id = body.get("roomId", "")
            name = body.get("name", "АГЕНТ")
            cur.execute(f"SELECT id FROM {SCHEMA}.rooms WHERE id = %s", (room_id,))
            if not cur.fetchone():
                return {"statusCode": 404, "headers": CORS, "body": json.dumps({"error": "room not found"})}
            cur.execute(
                f"SELECT COUNT(*) FROM {SCHEMA}.players WHERE room_id = %s AND updated_at > NOW() - INTERVAL '5 seconds'",
                (room_id,)
            )
            count = cur.fetchone()[0]
            color = PLAYER_COLORS[min(count, len(PLAYER_COLORS) - 1)]
            player_id = rand_id(8)
            cur.execute(
                f"INSERT INTO {SCHEMA}.players (id, room_id, name, x, y, color) VALUES (%s, %s, %s, 9, 7, %s) ON CONFLICT (id, room_id) DO UPDATE SET updated_at = NOW()",
                (player_id, room_id, name, color)
            )
            conn.commit()
            return {
                "statusCode": 200,
                "headers": CORS,
                "body": json.dumps({"playerId": player_id, "roomId": room_id, "color": color})
            }

        elif action == "move" and method == "POST":
            room_id = body.get("roomId", "")
            player_id = body.get("playerId", "")
            x = int(body.get("x", 9))
            y = int(body.get("y", 7))
            hiding = bool(body.get("hiding", False))
            dead = bool(body.get("dead", False))
            cur.execute(
                f"UPDATE {SCHEMA}.players SET x=%s, y=%s, hiding=%s, dead=%s, updated_at=NOW() WHERE id=%s AND room_id=%s",
                (x, y, hiding, dead, player_id, room_id)
            )
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        elif action == "room_state" and method == "POST":
            room_id = body.get("roomId", "")
            floor = body.get("floor")
            anomalies = body.get("anomalies")
            found_anomaly = body.get("foundAnomaly")
            monster = body.get("monster")
            step_count = body.get("stepCount")
            cleared_floors = body.get("clearedFloors")

            updates = []
            vals = []
            if floor is not None:
                updates.append("floor=%s"); vals.append(floor)
            if anomalies is not None:
                updates.append("anomalies=%s"); vals.append(json.dumps(anomalies))
            if found_anomaly is not None:
                updates.append("found_anomaly=%s"); vals.append(found_anomaly)
            if monster is not None:
                updates.append("monster=%s"); vals.append(json.dumps(monster))
            if step_count is not None:
                updates.append("step_count=%s"); vals.append(step_count)
            if cleared_floors is not None:
                updates.append("cleared_floors=%s"); vals.append(json.dumps(cleared_floors))

            if updates:
                updates.append("updated_at=NOW()")
                vals.append(room_id)
                cur.execute(f"UPDATE {SCHEMA}.rooms SET {', '.join(updates)} WHERE id=%s", vals)
                conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        elif action == "heartbeat" and method == "POST":
            room_id = body.get("roomId", "")
            player_id = body.get("playerId", "")
            cur.execute(
                f"UPDATE {SCHEMA}.players SET updated_at=NOW() WHERE id=%s AND room_id=%s",
                (player_id, room_id)
            )
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "unknown action"})}

    finally:
        cur.close()
        conn.close()
