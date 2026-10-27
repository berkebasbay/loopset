export const experimentsEaseMessages={
 purpose:{replications:'Measure how much one plan varies across independent random inputs.',paired:'Compare two captured plans using the same seed list. Input compatibility determines whether paired differences are valid.',search:'Test a finite set of base resource capacities, then verify the selected candidate on separate seeds.'},
 advancedSeeds:'Random input details',runCount:'Runs per plan',seedList:'Seed list',
 candidateMode:'How to enter candidate capacities',range:'Start / end / step',list:'Comma-separated list',start:'Starting capacity',end:'Ending capacity',step:'Capacity step',preview:'Capacities to evaluate',
 invalidRange:'Use whole capacities from 0 to 1,000, with end ≥ start and a positive whole step.',rangeLimit:'Choose at most 32 capacity candidates. Increase the step or use a shorter range.',invalidList:'Use 1–32 distinct whole capacities from 0 to 1,000, separated by commas with no empty entries.',
 searchVariables:(label:string,base:number,installed:number)=>`Search changes only ${label}’s base available units (currently ${base}, installed limit ${installed}). It does not change station counts, requirements or shifts.`,
 consumers:(labels:string)=>`Stages using this resource (parallel stations): ${labels}. A free resource unit alone does not guarantee a free station.`,
 unusedPool:'No processing step uses this resource. Changing it can change modeled cost without increasing processing capacity.',
 calendarOverrides:(n:number)=>`${n} calendar override periods remain fixed for every candidate. Base availability applies outside those periods.`,
 fullyCoveredCalendar:'The calendar covers the entire run. Base availability is never used, so these candidates do not change the resource’s availability schedule.',
 captureScope:'This experiment uses the two model snapshots captured from Compare. Navigation does not replace them with a later draft.',
}as const;
