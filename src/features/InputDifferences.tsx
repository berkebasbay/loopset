import type {SimulationModel} from '../model/types';
import {modelDifferences} from '../model/modelDiff';
import {modelDiffMessages as m} from '../ui/messages/modelDiff';
export function InputDifferences({before,after,compact=false}:{before:SimulationModel;after:SimulationModel;compact?:boolean}){
 const differences=modelDifferences(before,after);const rows=compact?differences.slice(0,5):differences;
 return <section className="ease-input-diff" aria-label={m.title}><h3>{m.title}<small>{m.count(differences.length)}</small></h3>{differences.length?<><dl>{rows.map(row=><div key={row.key}><dt>{row.label}</dt><dd><span>{m.before}: {row.before}</span><b aria-hidden="true">→</b><span>{m.after}: {row.after}</span></dd></div>)}</dl>{compact&&differences.length>5&&<details><summary>{m.count(differences.length-5)}</summary><dl>{differences.slice(5).map(row=><div key={row.key}><dt>{row.label}</dt><dd>{row.before} → {row.after}</dd></div>)}</dl></details>}</>:<p>{m.none}</p>}</section>;
}
