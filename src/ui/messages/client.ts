/** English product messages for client. Keep model data and canonical identifiers at the call site. */
export const clientMessages = {
  runAgainToRetry: (message: string) => `${message} Run again to retry.`,
  invalidWorkerResponse: (label: "experiment" | "simulation") => `The ${label} worker sent an incompatible or invalid response. Your draft and previous results are preserved. Run again to restart it; reload the page if this repeats.`,
  runAgainToRestartIt: (message: string) => `${message} Run again to restart it.`,
  unreadableWorkerResponse: (label: "experiment" | "simulation") => `The ${label} worker response could not be read. Your draft and previous results are preserved. Run again to restart it.`,
  workerStartFailed: (label: "experiment" | "simulation") => `The ${label} worker could not start. Run again to retry.`,
  supersededByANewRun: "Superseded by a new run.",
  workerRequestFailed: (label: "experiment" | "simulation") => `The ${label} request could not be sent to the worker. Your draft and previous results are preserved. Run again to retry.`,
  cancellationCouldNotBeSentYourDraftAndPrevious: "Cancellation could not be sent. Your draft and previous results are preserved. Run again to restart the worker.",
  experimentCancelled: "Experiment cancelled. No partial estimate was accepted. Run again to retry.",
  runCancelled: "Run cancelled.",
  workerStopped: (worker: 'simulation' | 'experiment') => `The ${worker} worker stopped unexpectedly.`,
} as const;
