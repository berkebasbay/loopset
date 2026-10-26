import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Focus, Route, X } from 'lucide-react';
import type { ModelNode } from '../model/types';
import { stepKindLabels } from '../ui/messages/labels';
import { flowGuideMessages as m } from '../ui/messages/FlowGuide';
import type { FlowLink, FlowWalk } from './flowPresentation';
import './flowGuide.css';

interface Props {
  nodes: Map<string, ModelNode>; walk: FlowWalk | null; shared: FlowLink[];
  open: boolean; cursor: number; unavailable?: string; suspended: boolean;
  onOpen: () => void; onClose: () => void; onCursor: (index: number) => void; onShow: (index: number) => void;
}

export function FlowGuide({ nodes, walk, shared, open, cursor, unavailable, suspended, onOpen, onClose, onCursor, onShow }: Props) {
  const id = useId(), opener = useRef<HTMLButtonElement>(null), paper = useRef<HTMLDivElement>(null), activeOpener = useRef<HTMLButtonElement | null>(null);
  const sharedDetails = useRef<HTMLDetailsElement>(null);
  const [sharedRequested, setSharedRequested] = useState(false), [sharedView, setSharedView] = useState<number | null>(null);
  const anchor = walk && nodes.get(walk.anchor), current = sharedView === null ? walk?.links[cursor] : shared.find(link => link.index === sharedView);
  const from = current && nodes.get(current.from), to = current && nodes.get(current.to);
  const close = () => { setSharedView(null); onClose(); (activeOpener.current ?? opener.current)?.focus({ preventScroll: true }); };
  const navigate = (index: number) => { setSharedView(null); onCursor(index); };
  const showShared = (link: FlowLink) => {
    const index = walk?.links.findIndex(item => item.index === link.index) ?? -1;
    if (index >= 0) navigate(index); else setSharedView(link.index);
    onShow(link.index);
  };
  const visible = open && !unavailable && !suspended;
  useEffect(() => { if (!visible) setSharedView(null); }, [visible]);
  useLayoutEffect(() => {
    const element = paper.current, scene = element?.closest('.world-workspace')?.querySelector('.scene-area');
    if (!element || !scene) return;
    // A dock must not size itself from the canvas that it shrinks. Keep its
    // scrolling body bounded by the viewport; floating paper reserves scene space.
    const docked = getComputedStyle(element).position === 'static';
    const size = () => { element.style.maxHeight = `${docked ? Math.min(200, Math.max(80, innerHeight * .28)) : Math.min(250, Math.max(80, scene.clientHeight - 150))}px`; };
    size();
    if (sharedRequested && sharedDetails.current) element.scrollTop = sharedDetails.current.offsetTop - 12;
    if (docked) { window.addEventListener('resize', size); return () => window.removeEventListener('resize', size); }
    const observer = new ResizeObserver(size); observer.observe(scene);
    return () => observer.disconnect();
  }, [visible, sharedRequested]);
  return <div className="flow-guide" data-guide-open={visible} onKeyDown={event => {
    // Tool/modal suspension wins. Escape within an open guide deliberately
    // closes it before the workbench's existing clear-selection shortcut.
    if (visible && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="flow-guide-footprint">
      <button ref={opener} type="button" className="flow-guide-opener" disabled={Boolean(unavailable) || !walk} aria-expanded={visible} aria-controls={id} title={unavailable ?? (anchor ? m.traceThrough(anchor.label) : m.chooseStep)} onClick={event => { if (visible) close(); else { activeOpener.current = event.currentTarget; setSharedRequested(false); onOpen(); } }}>
        <Route size={15} /><span>{unavailable ?? (anchor ? m.traceThrough(anchor.label) : m.chooseStep)}</span>
      </button>
      {shared.length > 0 && <button type="button" className="flow-shared-opener" disabled={Boolean(unavailable)} aria-expanded={visible} aria-controls={id} onClick={event => { activeOpener.current = event.currentTarget; setSharedRequested(true); onOpen(); }}>{m.sharedCount(shared.length)}</button>}
    </div>
    {visible && <div ref={paper} id={id} className="flow-guide-panel" role="region" aria-label={m.region} tabIndex={0}>
      <div className="flow-guide-heading"><div><strong>{walk ? !walk.hasSource || !walk.hasExit ? m.partial : m.possibleFlow : m.sharedCount(shared.length)}</strong><p className="flow-guide-anchor">{anchor ? m.inspectedAnchor(anchor.label) : m.noInspectedStep}</p></div><button type="button" aria-label={m.close} onClick={close}><X size={17} /></button></div>
      {current && from && to ? <>
        <div className="flow-guide-navigation"><button type="button" aria-label={m.previous} disabled={!walk?.links.length || cursor === 0} onClick={() => navigate(cursor - 1)}><ArrowLeft size={16} /></button><span>{sharedView === null ? m.connectionCount(cursor + 1, walk!.links.length) : m.samePosition}</span><button type="button" aria-label={m.next} disabled={!walk?.links.length || cursor === walk.links.length - 1} onClick={() => navigate(cursor + 1)}><ArrowRight size={16} /></button><button type="button" className="flow-show-connection" onClick={() => onShow(current.index)}><Focus size={15} />{m.showConnection}</button></div>
        <p className="flow-current-connection"><span>{m.currentConnection}</span><strong>{from.label} → {to.label}</strong><small>{stepKindLabels[from.kind]} → {stepKindLabels[to.kind]}{shared.some(link => link.index === current.index) ? ` · ${m.samePosition}` : ''}</small></p>
        {current.probability !== undefined && <p>{m.branchProbability(current.probability)}</p>}
        {sharedView !== null && <p>{m.sharedConnectionScope}</p>}
      </> : <p>{m.noConnection}</p>}
      {walk && <>
        <p>{m.staticScope}</p>
        {!walk.hasSource && <p className="flow-guide-warning">{m.sourceMissing}</p>}
        {!walk.hasExit && <p className="flow-guide-warning">{m.exitMissing}</p>}
        {walk.repeated && <p>{m.repeated}</p>}
        {walk.otherBranches > 0 && <p>{m.otherBranches(walk.otherBranches)}</p>}
        {walk.excludedBranches > 0 && <p>{m.excludedBranches(walk.excludedBranches)}</p>}
        <details><summary>{m.orderedSteps}</summary><ol className="flow-ordered-steps">{walk.ids.map((nodeId, index) => <li key={index} aria-current={sharedView === null && index === cursor ? 'step' : undefined}><button type="button" disabled={!walk.links.length} aria-label={m.viewStep(index + 1, nodes.get(nodeId)!.label)} onClick={() => navigate(Math.min(index, walk.links.length - 1))}>{nodes.get(nodeId)!.label}<small>{stepKindLabels[nodes.get(nodeId)!.kind]}{index === walk.anchorIndex ? ` · ${m.through}` : ''}</small></button></li>)}</ol></details>
      </>}
      {shared.length > 0 && <details ref={sharedDetails} open={sharedRequested} onToggle={event => setSharedRequested(event.currentTarget.open)}><summary>{m.sharedCount(shared.length)}</summary><p>{m.sharedPosition}</p><ul aria-label={m.sharedList} className="flow-shared-list">{shared.map(link => <li key={link.index}><span>{nodes.get(link.from)!.label} → {nodes.get(link.to)!.label}</span>{link.probability !== undefined && <p>{m.branchProbability(link.probability)}</p>}<button type="button" aria-label={m.showShared(nodes.get(link.from)!.label, nodes.get(link.to)!.label)} onClick={() => showShared(link)}><Focus size={15} />{m.showConnection}</button></li>)}</ul></details>}
    </div>}
  </div>;
}
