import { useEffect, useRef, useState } from 'react';
import type { PoseId, RoomStateForPlayer } from '../../../shared/src';
import { socket } from '../socket';
import { GameScene, type SceneMode } from '../three/GameScene';
import { PaintToolbar } from './PaintToolbar';
import { PlayerList } from './PlayerList';

function modeFor(room: RoomStateForPlayer): SceneMode {
  const { role, alive } = room.you;
  if (room.phase === 'hiding') return role === 'hider' && alive ? 'hiderPaint' : 'idle';
  if (room.phase === 'seeking') {
    if (role === 'seeker' && alive) return 'seeker';
    if (role === 'hider' && alive) return 'hiderFrozen';
    return 'spectate';
  }
  return 'spectate';
}

/** Live countdown to a server deadline, adjusted for clock offset. */
function Countdown({ room }: { room: RoomStateForPlayer }) {
  const [left, setLeft] = useState(0);
  const deadline = useRef(0);
  useEffect(() => {
    if (room.phaseEndsAt === null) return;
    deadline.current = Date.now() + (room.phaseEndsAt - room.serverNow);
    const update = () => setLeft(Math.max(0, deadline.current - Date.now()));
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [room.phaseEndsAt, room.serverNow]);
  if (room.phaseEndsAt === null) return null;
  const secs = Math.ceil(left / 1000);
  return (
    <span className={`countdown ${secs <= 10 ? 'urgent' : ''}`}>
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
    </span>
  );
}

export function GameView({ room }: { room: RoomStateForPlayer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GameScene | null>(null);
  const [scene, setScene] = useState<GameScene | null>(null);
  const [color, setColor] = useState('#3cb44b');
  const [flash, setFlash] = useState<string | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  // Mount the three.js scene once.
  useEffect(() => {
    const gs = new GameScene(containerRef.current!, {
      onMove: (pos, yaw) => socket.emit('move:update', { pos, yaw }),
      onStroke: (stroke) => socket.emit('paint:stroke', { stroke }),
      onColorSampled: (hex) => setColor(hex),
      onTag: (targetId) => socket.emit('tag:attempt', { targetId }),
    });
    sceneRef.current = gs;
    setScene(gs);

    const onMoved = (p: { id: string; pos: [number, number, number]; yaw: number; pose: PoseId }) =>
      gs.playerMoved(p.id, p.pos, p.yaw, p.pose);
    const onStroke = (p: { playerId: string; stroke: Parameters<GameScene['addStroke']>[1] }) => {
      if (p.playerId !== socket.id) gs.addStroke(p.playerId, p.stroke); // self already echoed locally
    };
    const onUndo = (p: { playerId: string }) => {
      if (p.playerId !== socket.id) gs.undoStroke(p.playerId);
    };
    const onPaintAll = (all: { playerId: string; strokes: Parameters<GameScene['setStrokes']>[1] }[]) => {
      for (const entry of all) gs.setStrokes(entry.playerId, entry.strokes);
    };
    socket.on('player:moved', onMoved);
    socket.on('paint:stroke', onStroke);
    socket.on('paint:undo', onUndo);
    socket.on('paint:all', onPaintAll);
    return () => {
      socket.off('player:moved', onMoved);
      socket.off('paint:stroke', onStroke);
      socket.off('paint:undo', onUndo);
      socket.off('paint:all', onPaintAll);
      gs.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Feed every room snapshot into the scene.
  useEffect(() => {
    const gs = sceneRef.current;
    if (!gs) return;
    gs.setSelf(room.you.id);
    gs.setMode(modeFor(room));
    gs.syncPlayers(room.players);
  }, [room]);

  // Tag hit/miss feedback.
  useEffect(() => {
    const onTagResult = (p: { seekerId: string; hit: boolean; hidersLeft: number }) => {
      if (room.you.role === 'seeker' && p.seekerId === room.you.id) {
        setFlash(p.hit ? '🎯 Found one!' : '❌ Nothing there…');
      } else if (room.you.role === 'hider') {
        setFlash(p.hit ? '😱 A hider was found!' : '😌 The seeker guessed wrong');
      }
      const t = setTimeout(() => setFlash(null), 2200);
      return () => clearTimeout(t);
    };
    socket.on('tag:result', onTagResult);
    return () => {
      socket.off('tag:result', onTagResult);
    };
  }, [room.you.role, room.you.id]);

  // Seeker tag cooldown ticker.
  useEffect(() => {
    const until = Date.now() + (room.you.nextTagAt - room.serverNow);
    const update = () => setCooldownLeft(Math.max(0, until - Date.now()));
    update();
    const t = setInterval(update, 100);
    return () => clearInterval(t);
  }, [room.you.nextTagAt, room.serverNow]);

  const { phase, you } = room;
  const isHost = room.players.find((p) => p.id === you.id)?.isHost ?? false;
  const hidersLeft = room.players.filter((p) => p.role === 'hider' && p.alive).length;
  const painting = phase === 'hiding' && you.role === 'hider' && you.alive;

  return (
    <main className="game3d">
      <div ref={containerRef} className="scene" />

      <div className="hud hud-top">
        <span className="phase-label">
          {phase === 'hiding' && (you.role === 'hider' ? '🎨 Camouflage yourself!' : '⏳ Hiders are painting…')}
          {phase === 'seeking' && (you.role === 'seeker' ? '🔍 Find the hiders!' : '🫥 Stay perfectly still!')}
          {phase === 'roundEnd' && '🏁 Round over'}
        </span>
        <Countdown room={room} />
        {phase === 'seeking' && <span className="hiders-left">{hidersLeft} hidden</span>}
      </div>

      {flash && <div className="hud flash">{flash}</div>}

      {painting && scene && (
        <PaintToolbar scene={scene} color={color} onColorChange={setColor} />
      )}

      {painting && (
        <div className="hud hint-bar">
          WASD to walk · drag your body to paint · drag elsewhere to orbit · pick a pose, then hold it
        </div>
      )}

      {phase === 'hiding' && you.role === 'seeker' && (
        <div className="overlay blackout">
          <h2>🙈 No peeking</h2>
          <p>The hiders are painting themselves into the scenery.</p>
          <p>You seek when the timer runs out. Get ready…</p>
          <Countdown room={room} />
        </div>
      )}

      {phase === 'seeking' && you.role === 'seeker' && you.alive && (
        <>
          <div className="crosshair">+</div>
          <div className="hud hint-bar">
            {cooldownLeft > 0
              ? `⏱ recharging ${(cooldownLeft / 1000).toFixed(1)}s — wrong guesses cost time`
              : 'Click a figure to tag it · WASD to move · click canvas to capture the mouse'}
          </div>
        </>
      )}

      {phase === 'seeking' && you.role === 'hider' && !you.alive && (
        <div className="hud hint-bar">You were found! Spectating — drag to look around.</div>
      )}

      {phase === 'roundEnd' && room.result && (
        <div className="overlay">
          <h2>{room.result.winner === 'hiders' ? '🫥 Hiders win!' : '🔍 Seekers win!'}</h2>
          <p>{room.result.reason}</p>
          {room.result.survivors.length > 0 && (
            <p>
              Survived:{' '}
              {room.result.survivors
                .map((id) => room.players.find((p) => p.id === id)?.name ?? '?')
                .join(', ')}
            </p>
          )}
          <PlayerList room={room} />
          {isHost ? (
            <button className="primary" onClick={() => socket.emit('game:again')}>
              Back to lobby
            </button>
          ) : (
            <p className="hint">Waiting for the host…</p>
          )}
        </div>
      )}
    </main>
  );
}
