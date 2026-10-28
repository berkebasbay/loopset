export const starterMessages = {
  heading: 'Find your next process',
  subtitle: 'Twelve editable facilities. Each includes a starting plan and two experiments.',
  search: 'Search starter templates', all: 'All templates',
  categories: { production: 'Production', logistics: 'Logistics', service: 'Service', events: 'Events' },
  detail: 'Template details', open: 'Open this template', back: 'All starter templates',
  previewDescription: (title: string) => `${title} facility layout`,
  question: 'What will you explore?', assumptions: 'Starting assumptions', trials: 'Two experiments to try',
  scope: 'Synthetic teaching models. Timings, demand and staffing are illustrative; layout does not add travel time.',
  empty: 'No starter templates match your search.', loading: 'Opening template…',
  failed: 'This template could not be opened. Your current project is kept. Try again.',
  superseded: 'The template was not opened because the workspace changed. Choose it again when ready.',
  invalid: 'The template file does not match this catalogue. Your current project is kept.',
  duration: (minutes: number) => minutes >= 60 ? `${minutes / 60} hr run` : `${minutes} min run`,
  steps: (count: number) => `${count} process steps`,
  objects: (count: number) => `${count} layout objects`,
  brief: 'Project brief', briefSection: 'PROJECT BRIEF',
  briefIntro: 'Apply a saved plan, then run it to compare. Undo returns to your previous work.',
  notes: 'Project notes and assumptions', plans: 'Try a saved plan',
  original: 'Original plan', apply: 'Apply this plan', applied: 'Plan applied. Run the simulation to compare its results.',
  briefEmpty: 'This project has no saved alternatives yet. Save a scenario in Compare plans to keep a starting point.',
  briefScope: 'These notes describe the starting assumptions. Review your current settings after editing.',
  compare: 'Open comparison', sameInputs: 'Numerical inputs match the current plan.',
  restoresLayout: 'Applying a saved plan also restores its layout. Undo returns to your current work.', exactChanges: 'Review exact input changes',
} as const;

export const starterCopy = {
  factory: {
    title: 'Little Factory', summary: 'Three stages, one growing packing queue.', question: 'Does another station help when the same team must staff it?',
    assumptions: ['One hour of variable order arrivals; no warm-up period.', 'Machining, inspection and packing each need their own team.', 'Staff are occupied for the full service duration. Material stock and transport are not modeled.'],
    trials: [
      { title: 'Extra packing station', change: 'Two packing stations share the original one-person team.' },
      { title: 'Staff both stations', change: 'Keep two packing stations and make two packing team units available.' },
    ],
  },
  workshop: {
    title: 'Workshop', summary: 'A U-shaped work cell with a timed curing stage.', question: 'Would flexible staffing or a shorter curing stage make a bigger difference?',
    assumptions: ['Two hours of evenly released jobs.', 'Preparation and machining share two operators; finishing has one dedicated operator.', 'Curing is a resource-free delay with unlimited space, not a finite rack or a chemical model.'],
    trials: [
      { title: 'Cross-trained team', change: 'Pool the same three operators across preparation, machining and finishing.' },
      { title: 'Shorter curing study', change: 'Test a 120-second cure instead of 300 seconds, with staffing unchanged.' },
    ],
  },
  festival: {
    title: 'Festival Gate', summary: 'Arrival waves meet three staffed checkpoints.', question: 'How much security coverage is useful during the entrance rush?',
    assumptions: ['One hour of visitor arrivals, with a busier middle period.', 'Visitors leave the final queue after 15 minutes without service.', 'Lane capacity and staff availability are independent. Walking and crowd collisions are illustrative.'],
    trials: [
      { title: 'Peak security cover', change: 'Open a second lane and staff it from minute 10 to minute 50.' },
      { title: 'All-hour security cover', change: 'Staff two security lanes for the full hour.' },
    ],
  },
  service: {
    title: 'Service Studio', summary: 'Priority requests share a specialist team.', question: 'What changes when you cover the break or serve requests in arrival order?',
    assumptions: ['One hour of requests; 15% have higher queue priority.', 'Two specialist stages share two staff; one is unavailable during a five-minute break.', 'Queue priority does not interrupt work already in service.'],
    trials: [
      { title: 'Cover the team break', change: 'Keep two specialists available during the five-minute break.' },
      { title: 'First come, first served', change: 'Use FIFO at all waiting areas, preserving request mix and staffing.' },
    ],
  },
  machining: {
    title: 'Machining Cell', summary: 'Two job routes compete for shared operators.', question: 'Is the limiting factor the slower machine or the operator pool?',
    assumptions: ['Two hours of fixed job releases; jobs take one of two machining routes.', 'Each occupied machine holds one operator throughout its service.', 'Equipment is illustrative sourced metalworking artwork; toolpaths, changeovers and CNC control are not modeled.'],
    trials: [
      { title: 'Duplicate the slow station', change: 'Add a second slow machining station, retaining the original operator pool.' },
      { title: 'Staff the added station', change: 'Keep the extra station and increase the operator pool from two to three.' },
    ],
  },
  quality: {
    title: 'Quality & Rework', summary: 'Inspection sends some items back for repair.', question: 'Does more inspection capacity help as much as reducing rework?',
    assumptions: ['Two hours of fixed releases into a repeatable inspection loop.', 'Each inspection independently sends 12% of items to repair and reinspection.', 'Repair time is positive; the model has no physical defect or measurement simulation.'],
    trials: [
      { title: 'Second inspection team', change: 'Add one staffed inspection station; retain the 12% rework probability.' },
      { title: 'Lower rework study', change: 'Test a 4% rework probability with the original inspection capacity.' },
    ],
  },
  packing: {
    title: 'Packing Hall', summary: 'Standard and bulky parcels use separate benches.', question: 'Where should the next packing resource go?',
    assumptions: ['Two hours of demand, routed 75% to standard packing and 25% to bulky packing.', 'Both lanes share a packing crew before a common label-check step.', 'Routing probabilities represent a synthetic parcel mix; packing materials and inventory are unlimited.'],
    trials: [
      { title: 'Extra bulky bench', change: 'Add a second bulky-parcel bench without changing the shared crew.' },
      { title: 'Larger packing crew', change: 'Keep the extra bulky bench and add a third shared packing worker.' },
    ],
  },
  fulfillment: {
    title: 'Order Fulfillment', summary: 'Pick, pack and hand off a wave of orders.', question: 'Could smoothing order releases outperform moving a worker?',
    assumptions: ['Exactly 120 orders are released in two bursts during a two-hour shift.', 'Picking and packing have separate teams; inventory is always available.', 'Picking time is an aggregate service duration, not a walking route or multi-item assembly model.'],
    trials: [
      { title: 'Rebalance the crew', change: 'Move one worker from picking to packing; total headcount stays the same.' },
      { title: 'Smooth order releases', change: 'Release the same 120 orders evenly over the first 100 minutes.' },
    ],
  },
  returns: {
    title: 'Returns Center', summary: 'Triage separates restocking from refurbishment.', question: 'Should you speed up intake or add refurbishment capacity?',
    assumptions: ['Two hours of arrivals; 60% go to restocking and 40% to refurbishment.', 'The two outcomes use independent teams and exits.', 'The model follows individual return jobs; refunds, stock balances and resale value are excluded.'],
    trials: [
      { title: 'Faster intake study', change: 'Reduce triage time from 60 to 40 seconds with the same staff.' },
      { title: 'Staff a second repair bench', change: 'Add one refurbishment station and its worker.' },
    ],
  },
  parcel: {
    title: 'Parcel Hub', summary: 'Three arrival bursts feed scan and dispatch desks.', question: 'Can a short cover shift handle the dispatch peak?',
    assumptions: ['Exactly 150 parcels arrive in three ten-minute bursts across a two-hour shift.', 'Dispatch has two physical stations but only one worker in the original plan.', 'Parcels are processed individually; vehicles, conveyors and consolidated departure loads are not modeled.'],
    trials: [
      { title: 'Peak dispatch cover', change: 'Staff both dispatch stations between minutes 30 and 90.' },
      { title: 'Even parcel releases', change: 'Spread the same 150 parcels evenly across the first 100 minutes.' },
    ],
  },
  repair: {
    title: 'Repair Workshop', summary: 'Diagnosis and repair share a technician pool.', question: 'What is the trade-off between break cover and an extra technician?',
    assumptions: ['Two hours of requests; 20% have higher queue priority.', 'Diagnosis and repair share two technicians, reduced to one from minute 50 to 70.', 'Durations are illustrative; parts availability and specific repair procedures are excluded.'],
    trials: [
      { title: 'Relief during the break', change: 'Keep two technicians available during the twenty-minute break.' },
      { title: 'Third technician', change: 'Use three technicians normally and two during the break.' },
    ],
  },
  print: {
    title: '3D Print Studio', summary: 'Mixed-duration print jobs meet a finishing queue.', question: 'How does variability affect flow when the average print time is unchanged?',
    assumptions: ['An eight-hour shift with an illustrative mix of 5–60 minute print jobs.', 'Two printers operate without a shared operator requirement; finishing needs one worker.', 'Print duration samples are invented. Geometry, material use, thermal behavior and batch packing are excluded.'],
    trials: [
      { title: 'Same mean, steady jobs', change: 'Replace variable print times with a constant of the same mean.' },
      { title: 'Second finishing bench', change: 'Add one staffed finishing station, keeping variable print jobs.' },
    ],
  },
} as const;
