export const replayEaseMessages={
 jump:'Go to recorded time',targetTime:'Jump to time',go:'Go',start:'Recorded start',end:'Recorded end',
 coverage:(until:string)=>`Recorded interval: 0 → ${until}. Full-run outcomes stay fixed.`,
 invalidTime:'Enter a valid time within the recorded interval, or Escape to cancel the unfinished entry.',
 focus:'Focus selected',fullscreen:'Fullscreen',replayShortcut:'Space',
}as const;
