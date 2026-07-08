import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Stroke } from '../../../shared/src';

interface Props {
  strokes: Stroke[];
  /** Enable drawing; the finished stroke is passed up on pointer release. */
  canDraw: boolean;
  myColor: string;
  onStroke: (points: [number, number][]) => void;
}

const CANVAS_SIZE = 1000; // internal resolution; CSS scales it responsively
const LINE_WIDTH = CANVAS_SIZE * 0.012;

function drawStroke(ctx: CanvasRenderingContext2D, color: string, points: [number, number][]) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0][0] * CANVAS_SIZE, points[0][1] * CANVAS_SIZE);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x * CANVAS_SIZE, y * CANVAS_SIZE);
  ctx.stroke();
}

export function Canvas({ strokes, canDraw, myColor, onStroke }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The in-progress stroke lives in a ref (not state) so releasing the
  // pointer sends it exactly once; `tick` just triggers repaints.
  const draft = useRef<[number, number][]>([]);
  const drawing = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    for (const s of strokes) drawStroke(ctx, s.color, s.points);
    drawStroke(ctx, myColor, draft.current);
  }, [strokes, tick, myColor]);

  const toPoint = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    drawing.current = true;
    canvasRef.current!.setPointerCapture(e.pointerId);
    draft.current = [toPoint(e)];
    setTick((t) => t + 1);
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    draft.current.push(toPoint(e));
    setTick((t) => t + 1);
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const points = draft.current;
    draft.current = [];
    setTick((t) => t + 1);
    if (points.length >= 2) onStroke(points);
  };

  return (
    <canvas
      ref={canvasRef}
      className={canDraw ? 'canvas can-draw' : 'canvas'}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}
