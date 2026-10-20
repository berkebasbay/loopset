const boundaries = new WeakMap<HTMLInputElement, { settings: string; maximum: string }>();

/** Browsers can round a range's serialized value, even with step="any".
 * Match its own endpoint representation, then select the exact recorded time.
 * This is presentation input handling; engine timestamps never use a tolerance. */
export function replayTimeFromRange(input: HTMLInputElement, endpoint: number): number {
  const settings = JSON.stringify([input.min, input.max, input.step]);
  let boundary = boundaries.get(input);
  if (!boundary || boundary.settings !== settings) {
    const probe = input.cloneNode(false) as HTMLInputElement;
    // Numeric assignment follows native slider serialization in Firefox too.
    probe.valueAsNumber = Number(probe.max);
    boundary = { settings, maximum: probe.value };
    boundaries.set(input, boundary);
  }
  const time = input.value === boundary.maximum ? endpoint : input.valueAsNumber;
  return Number.isFinite(time) ? Math.max(0, Math.min(time, endpoint)) : 0;
}
