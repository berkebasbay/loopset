import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, LoaderCircle, Plus, Search } from 'lucide-react';
import { assetURL } from '../assetUrl';
import { starterTemplates, type StarterCategory, type StarterId } from '../templates/catalogue';
import inventory from '../templates/inventory.json';
import { starterMessages as m } from '../ui/messages/starterTemplates';
import { templateMessages as tm } from '../ui/messages/templates';
import './starterGallery.css';

interface Props { busy: boolean; blocked?: boolean; onChoose: (id: StarterId | 'blank') => void }
export function StarterGallery({ busy, blocked, onChoose }: Props) {
  const [query, setQuery] = useState(''), [category, setCategory] = useState<StarterCategory | ''>('');
  const [selected, setSelected] = useState<StarterId | null>(null);
  const host = useRef<HTMLDivElement>(null), detailHeading = useRef<HTMLHeadingElement>(null), previous = useRef<StarterId | null>(null);
  const item = starterTemplates.find(item => item.id === selected);
  const matches = starterTemplates.filter(item => (!category || item.category === category) && `${item.copy.title} ${item.copy.summary} ${item.copy.question} ${m.categories[item.category]}`.toLocaleLowerCase('en').includes(query.trim().toLocaleLowerCase('en')));
  useEffect(() => {
    const last = previous.current; previous.current = selected;
    if (!selected && !last) return;
    const frame = requestAnimationFrame(() => {
      if (selected) { const scroller = host.current?.closest('.modal-body'); if (scroller) scroller.scrollTop = 0; detailHeading.current?.focus({ preventScroll: true }); }
      else host.current?.querySelector<HTMLButtonElement>(`[data-starter-id="${last}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);
  return <div ref={host} className="starter-gallery">
    {item ? <>
      <button type="button" className="starter-back" disabled={busy} onClick={() => setSelected(null)}><ArrowLeft size={15} />{m.back}</button>
      <div className="starter-detail">
        <div className="starter-preview"><img src={assetURL(`/previews/templates/${item.id}.png?v=${inventory[item.id].sha256.slice(0, 16)}`)} alt={`${item.copy.title} facility layout`} width="1280" height="720" /><div className="starter-facts"><span>{m.categories[item.category]}</span><span><Clock3 size={13} />{m.duration(item.minutes)}</span><span>{m.steps(inventory[item.id].steps)}</span><span>{m.objects(inventory[item.id].objects)}</span></div></div>
        <div className="starter-brief"><span className="eyebrow">{m.detail}</span><h3 tabIndex={-1} ref={detailHeading}>{item.copy.title}</h3><p className="starter-question">{item.copy.question}</p>
          <button type="button" className="ql-button ql-primary starter-open" disabled={busy || blocked} onClick={() => onChoose(item.id)}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{busy ? m.loading : m.open}</button>
          <p className="starter-scope">{m.scope}</p>
        </div>
        <section className="starter-assumptions"><h4>{m.assumptions}</h4><ul>{item.copy.assumptions.map(text => <li key={text}>{text}</li>)}</ul></section>
        <section className="starter-trials"><h4>{m.trials}</h4>{item.copy.trials.map((trial, i) => <div key={trial.title}><span>{String(i + 1).padStart(2, '0')}</span><div><h5>{trial.title}</h5><p>{trial.change}</p></div></div>)}</section>
      </div>
    </> : <>
      <div className="starter-library-heading"><h3>{m.heading}</h3><p>{m.subtitle}</p></div>
      <div className="starter-filters"><label className="starter-search"><Search size={17} /><input type="search" aria-label={m.search} placeholder={m.search} value={query} onChange={event => setQuery(event.currentTarget.value)} disabled={busy} /></label><label><span className="sr-only">{tm.starters}</span><select aria-label={m.all} value={category} disabled={busy} onChange={event => setCategory(event.currentTarget.value as StarterCategory | '')}><option value="">{m.all}</option>{Object.entries(m.categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <button type="button" className="template-starter template-blank" disabled={busy || blocked} onClick={() => onChoose('blank')}><span className="template-blank-icon"><Plus size={23} /></span><div><h3>{tm.blank}</h3><p>{tm.blankDescription}</p></div><ArrowRight size={17} /></button>
      <div className="starter-cards">{matches.map(item => <button type="button" className="template-starter starter-card" key={item.id} data-starter-id={item.id} disabled={busy} onClick={() => setSelected(item.id)}><img src={assetURL(`/previews/templates/${item.id}.png?v=${inventory[item.id].sha256.slice(0, 16)}`)} alt="" width="1280" height="720" loading="lazy" /><div><span className="starter-category">{m.categories[item.category]}</span><h3>{item.copy.title}</h3><p>{item.copy.summary}</p><footer><span>{m.duration(item.minutes)}</span><ArrowRight size={16} /></footer></div></button>)}</div>
      {!matches.length && <p className="starter-no-matches" role="status">{m.empty}</p>}
    </>}
  </div>;
}
