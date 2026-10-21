/** Recovery instructions surfaced by browser export actions, separate from portable report data. */
export const exportErrorMessages = {
  printWindowBlocked: 'The print window was blocked. Allow this window or download the report HTML.',
  imageContextUnavailable: 'This browser could not create a result image. Download the CSV or HTML report instead.',
  pngEncodingTimedOut: 'PNG encoding timed out. Try again or download the CSV or HTML report.',
  pngEncodingFailed: 'The browser could not encode the result PNG. Download the CSV or HTML report instead.',
} as const;
