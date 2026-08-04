import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Brush, Eraser, RotateCcw, RotateCw, Save, Trash2, X } from 'lucide-react';

import { ModiffFieldShell, SectionHeader, StudioButton, StudioChip, StudioSlider } from '../ui';
import { cx } from '../utils/classNames';

const CANVAS_SIZE = 512;
const OPACITY_CLASSES: Record<number, string> = {
  25: 'opacity-25',
  50: 'opacity-50',
  75: 'opacity-75',
  100: 'opacity-100',
};

type MaskMode = 'brush' | 'erase';

type StudioMaskEditorProps = {
  sourceImage?: string;
  maskImage?: string;
  onSave: (maskImage: string) => void;
  onCancel: () => void;
};

export function StudioMaskEditor({ sourceImage, maskImage, onCancel, onSave }: StudioMaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [mode, setMode] = useState<MaskMode>('brush');
  const [brushSize, setBrushSize] = useState(34);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const snapshot = () => canvasRef.current?.toDataURL('image/png') ?? '';

  const pushHistory = () => {
    const current = snapshot();
    if (!current) return;
    setHistory((items) => [current, ...items].slice(0, 20));
    setRedoStack([]);
  };

  const loadMask = (value: string) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      context.fillStyle = 'black';
      context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      context.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    };
    image.src = value;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.fillStyle = 'black';
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (maskImage) {
      loadMask(maskImage);
    }
  }, [maskImage]);

  const drawAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE;
    const y = ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE;
    context.beginPath();
    context.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    context.fillStyle = mode === 'brush' ? 'white' : 'black';
    context.fill();
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    pushHistory();
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawAt(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawAt(event);
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const undo = () => {
    const previous = history[0];
    if (!previous) return;
    const current = snapshot();
    setRedoStack((items) => (current ? [current, ...items].slice(0, 20) : items));
    setHistory((items) => items.slice(1));
    loadMask(previous);
  };

  const redo = () => {
    const next = redoStack[0];
    if (!next) return;
    const current = snapshot();
    setHistory((items) => (current ? [current, ...items].slice(0, 20) : items));
    setRedoStack((items) => items.slice(1));
    loadMask(next);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    pushHistory();
    context.fillStyle = 'black';
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  };

  const invert = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    pushHistory();
    const imageData = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    for (let index = 0; index < imageData.data.length; index += 4) {
      imageData.data[index] = 255 - (imageData.data[index] ?? 0);
      imageData.data[index + 1] = 255 - (imageData.data[index + 1] ?? 0);
      imageData.data[index + 2] = 255 - (imageData.data[index + 2] ?? 0);
      imageData.data[index + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
  };

  return (
    <section>
      <SectionHeader title="Mask editor" />
      <div className="grid gap-2">
        <div className="relative aspect-square overflow-hidden border border-modiff-border bg-modiff-bg">
          {sourceImage && (
            <img
              src={sourceImage}
              alt="Source overlay"
              className={cx('absolute inset-0 h-full w-full object-contain', OPACITY_CLASSES[overlayOpacity])}
            />
          )}
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="relative z-10 h-full w-full touch-none mix-blend-screen"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <StudioChip active={mode === 'brush'} onClick={() => setMode('brush')}>
            <Brush size={13} /> Brush
          </StudioChip>
          <StudioChip active={mode === 'erase'} onClick={() => setMode('erase')}>
            <Eraser size={13} /> Erase
          </StudioChip>
          <StudioChip onClick={invert}>Invert</StudioChip>
          <StudioChip onClick={clear}>
            <Trash2 size={13} /> Clear
          </StudioChip>
          <StudioChip onClick={undo} disabled={history.length === 0}>
            <RotateCcw size={13} /> Undo
          </StudioChip>
          <StudioChip onClick={redo} disabled={redoStack.length === 0}>
            <RotateCw size={13} /> Redo
          </StudioChip>
        </div>
        <ModiffFieldShell label={`Brush size: ${brushSize}`}>
          <StudioSlider min={4} max={120} value={brushSize} onChange={setBrushSize} />
        </ModiffFieldShell>
        <div>
          <p className="mb-1 text-xs text-modiff-subtle-text">Source overlay: {overlayOpacity}%</p>
          <div className="flex flex-wrap gap-1">
            {[25, 50, 75, 100].map((value) => (
              <StudioChip key={value} active={overlayOpacity === value} onClick={() => setOverlayOpacity(value)}>
                {value}%
              </StudioChip>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StudioButton tone="primary" icon={<Save size={15} />} onClick={() => onSave(snapshot())}>
            Save mask
          </StudioButton>
          <StudioButton tone="ghost" icon={<X size={15} />} onClick={onCancel}>
            Cancel
          </StudioButton>
        </div>
      </div>
    </section>
  );
}
