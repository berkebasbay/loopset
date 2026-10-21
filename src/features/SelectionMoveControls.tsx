import { selectionMoveControlsMessages as m } from '../ui/messages/SelectionMoveControls';
import { useId, useState } from 'react';
import type { Point, Project } from '../model/types';
import { previewTranslation } from './layoutCommands';
import './editorControls.css';

interface Props { project: Project; ids: string[]; onMove: (ids: string[], delta: Point) => void }
export function SelectionMoveControls({ project, ids, onMove }: Props) {
  const [amount, setAmount] = useState('0.5'); const id = useId();
  const value = Number(amount), valid = amount.trim() !== '' && Number.isFinite(value) && value > 0 && value <= 200;
  const moves = [{ name: 'left' as const, delta: { x: -value, z: 0 }, icon: '←' }, { name: 'right' as const, delta: { x: value, z: 0 }, icon: '→' }, { name: 'back' as const, delta: { x: 0, z: -value }, icon: '↑' }, { name: 'forward' as const, delta: { x: 0, z: value }, icon: '↓' }];
  return <fieldset className="selection-move"><legend>{m.moveLegend(ids.length)}</legend><p>{m.visualMoveHelp}</p><label htmlFor={id}>{m.moveAmountVisualUnits}<input id={id} type="number" min="0.001" max="200" step="any" value={amount} onChange={event => setAmount(event.target.value)} /></label><div className="selection-move-buttons">{moves.map(move => {
    const preview = valid && ids.length ? previewTranslation(project, ids, move.delta) : null;
    const disabled = !preview || Boolean(preview.error) || (preview.delta.x === 0 && preview.delta.z === 0);
    return <button key={move.name} type="button" className="ql-button" disabled={disabled} aria-label={m.moveSelected(m.directions[move.name])} title={preview?.error ?? m.moveSelected(m.directions[move.name])} onClick={() => onMove(ids, move.delta)}><span aria-hidden="true">{move.icon}</span>{m.directions[move.name]}</button>;
  })}</div>{!valid && <small>{m.invalidMoveAmount}</small>}{valid && ids.length > 0 && previewTranslation(project, ids, { x: 0, z: 0 }).error && <small role="status">{previewTranslation(project, ids, { x: 0, z: 0 }).error}</small>}</fieldset>;
}
