/** English product messages for ReplayCoverageDetails. Keep model data and canonical identifiers at the call site. */
export const replayCoverageDetailsMessages = {
  replayCoverage: "Replay coverage",
  intervalEndpointsHelp: "These intervals contain recorded instantaneous states. Both endpoints are included.",
  availableReplayIntervals: "Available replay intervals",
  seconds: " seconds",
  replayStopsAtTheLastFullyRetainedTimestampNo: "Replay stops at the last fully retained timestamp. No instantaneous state is available after this coverage.",
  noDetailedReplayIntervalWasRetainedForThisRun: "No detailed replay interval was retained for this run. The timeline cannot show an observed instantaneous state.",
  completeNumericalCoverage: "Numerical results cover the full requested run, independently of replay retention.",
  incompleteNumericalCoverage: (simulatedUntil: number) => `Numerical results are incomplete; execution stopped at ${simulatedUntil} seconds.`,
  replayIndexEvidence: "Replay index evidence",
  indexAccountingHelp: "Presentation checkpoints and event ranges support seeking. Estimated allocations below are accounting values, not a measurement or guarantee of total memory use.",
  replayIndexData: "Replay index data",
} as const;
