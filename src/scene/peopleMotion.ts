import type { PersonDraw } from './AnimatedPeople';
export interface PersonTarget extends Omit<PersonDraw, 'moving' | 'distance'> { spawn?: { x: number; y: number; z: number } }
type MotionState = PersonDraw & { target: PersonTarget; retiring: boolean; retireAge: number };
const distance = (a: PersonDraw['position'], b: PersonDraw['position']) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Visual wall-clock interpolation only. Never writes a model, frame or run result. */
export class PeopleMotion {
  private states = new Map<string, MotionState>();
  private last: number | null = null;
  step(targets: readonly PersonTarget[], options: {
    now: number; animate: boolean; reset: boolean; speed: number;
    retire: (person: PersonDraw) => PersonTarget | null;
  }): { people: PersonDraw[]; moving: boolean } {
    const elapsed = this.last === null ? 0 : Math.min(.05, Math.max(0, (options.now - this.last) / 1000));
    this.last = options.now;
    if (options.reset) this.states.clear();
    const active = new Set(targets.map(target => target.id));
    for (const target of targets.slice(0, 560)) {
      let state = this.states.get(target.id);
      if (!state) {
        const position = options.reset || !options.animate || !target.spawn ? target.position : target.spawn;
        state = { ...target, position: { ...position }, moving: false, distance: 0, target, retiring: false, retireAge: 0 };
        this.states.set(target.id, state);
      }
      state.target = target; state.variant = target.variant; state.nodeId = target.nodeId; state.role = target.role;
      state.retiring = false; state.retireAge = 0;
      if (options.reset) { state.position = { ...target.position }; state.heading = target.heading; }
    }
    for (const [id, state] of this.states) {
      if (active.has(id)) continue;
      if (!state.retiring) {
        const target = options.retire(state);
        if (!target || options.reset) { this.states.delete(id); continue; }
        state.target = target; state.nodeId = target.nodeId; state.retiring = true; state.retireAge = 0;
      }
      if (state.retireAge > 10_000 || this.states.size > 600) this.states.delete(id);
    }
    let moving = false;
    for (const [id, state] of this.states) {
      if (state.retiring && options.animate) state.retireAge += elapsed * 1000;
      const remaining = distance(state.position, state.target.position);
      if (remaining < .025) {
        state.position = { ...state.target.position }; state.heading = state.target.heading; state.moving = false;
        if (state.retiring) this.states.delete(id);
        continue;
      }
      if (!options.animate || !elapsed) continue;
      const amount = Math.min(remaining, options.speed * elapsed);
      const dx = state.target.position.x - state.position.x, dz = state.target.position.z - state.position.z;
      state.heading = Math.atan2(dx, dz);
      state.position = { x: state.position.x + dx / remaining * amount, y: state.position.y + (state.target.position.y - state.position.y) / remaining * amount, z: state.position.z + dz / remaining * amount };
      state.distance += amount; state.moving = true; moving = true;
    }
    return { people: [...this.states.values()].slice(0, 600).map(({ target: _target, retiring: _retiring, retireAge: _retireAge, ...person }) => person), moving };
  }
  clear() { this.states.clear(); this.last = null; }
}
