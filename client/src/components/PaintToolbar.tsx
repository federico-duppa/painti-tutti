import { useState } from 'react';
import { POSES, type PoseId } from '../../../shared/src';
import { socket } from '../socket';
import type { GameScene } from '../three/GameScene';

const SWATCHES = [
  '#e6194b', '#f58231', '#ffd60a', '#3cb44b', '#2a9d8f', '#42d4f4',
  '#4363d8', '#911eb4', '#f032e6', '#9a6324', '#41424d', '#f2f2f2',
];

const POSE_LABELS: Record<PoseId, string> = {
  stand: '🧍 Stand',
  crouch: '🏋 Crouch',
  sit: '🪑 Sit',
  lie: '🛏 Lie flat',
  armsUp: '🙌 Arms up',
};

interface Props {
  scene: GameScene;
  color: string;
  onColorChange: (hex: string) => void;
}

/** Brush / eyedropper / pose controls shown to hiders during the hiding phase. */
export function PaintToolbar({ scene, color, onColorChange }: Props) {
  const [tool, setTool] = useState<'brush' | 'eyedropper'>('brush');
  const [size, setSize] = useState(14);
  const [pose, setPose] = useState<PoseId>('stand');

  scene.tool = tool;
  scene.color = color;
  scene.brushSize = size;

  const pickPose = (p: PoseId) => {
    setPose(p);
    scene.setSelfPose(p);
    socket.emit('pose:set', { pose: p });
  };

  return (
    <div className="hud toolbar">
      <div className="toolbar-row">
        <button
          className={`tool ${tool === 'brush' ? 'active' : ''}`}
          title="Brush — drag on your body"
          onClick={() => setTool('brush')}
        >
          🖌
        </button>
        <button
          className={`tool ${tool === 'eyedropper' ? 'active' : ''}`}
          title="Eyedropper — click anything in the scene to sample its color"
          onClick={() => setTool('eyedropper')}
        >
          💧
        </button>
        <span className="current-color" style={{ background: color }} title={color} />
        {SWATCHES.map((c) => (
          <button
            key={c}
            className="swatch-btn"
            style={{ background: c }}
            onClick={() => {
              onColorChange(c);
              setTool('brush');
            }}
          />
        ))}
        <label className="size-label">
          size
          <input
            type="range"
            min={4}
            max={48}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <button
          className="tool"
          title="Undo last stroke"
          onClick={() => {
            scene.undoStroke(socket.id!);
            socket.emit('paint:undo');
          }}
        >
          ↩️
        </button>
      </div>
      <div className="toolbar-row">
        {POSES.map((p) => (
          <button
            key={p}
            className={`tool pose ${pose === p ? 'active' : ''}`}
            onClick={() => pickPose(p)}
          >
            {POSE_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
