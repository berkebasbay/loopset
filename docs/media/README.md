# Loopset demonstration

[Watch the 67-second demo](loopset-demo.mp4) · [Animated preview](loopset-demo.gif) · [English captions](loopset-demo.vtt)

The film uses the actual RC14 interface in one synthetic Little Factory project. It opens a template, places a shelf, changes packing stations and team capacity, runs comparisons, then saves and reuses the setup.

One extra packing station leaves output unchanged until its team capacity is increased deliberately: 40 → 40 → 77 completed orders, with modeled resource cost $74 → $74 → $96. Mean waiting changes from 14.5 to 1.4 minutes. Each plan uses the same 80 modeled arrivals, one-hour duration and seed 4207. This is one synthetic case, not a business forecast; resource cost is not total operating cost. Placing a shelf changes the layout, not the calculation.

The MP4 is 1920×1080 at 60 fps with English screen text, music and effects. Native browser footage was captured at 25 fps; the camera and typography animate at 60 fps. Editorial crops, shortened pauses and held comparison frames make the real actions and results readable. No UI controls or intermediate numerical results are reconstructed. The animated preview is a silent excerpt from the same film.

Produced with [HyperFrames](https://github.com/heygen-com/hyperframes), [Cinetic](https://github.com/Leonxlnx/cinetic) and [Earshot](https://github.com/Leonxlnx/earshot). The soundtrack is an original synthesized arrangement with code-generated effects; it contains no sampled reference-film music or voiceover. DM Sans, GSAP and the underlying artwork retain their own licences: see [third-party notices](../../THIRD_PARTY_NOTICES.md) and [asset provenance](../NVIDIA_ASSETS.md).

## Interface screenshots

`loopset-facility.png` and `loopset-templates.png` capture the RC14 facility workspace and template gallery. The Little Factory layout uses the unchanged Factory numerical process with 57 independently editable objects. Its source project is [`examples/facility.json`](../../examples/facility.json). The video adds one shelf, keeping 58 layout objects through the experiment. Local-origin footers are excluded from the media.

`loopset-insights.png` shows recorded outcomes from the same synthetic process. `loopset-compare.png` shows its deliberate station/team comparison, 40 → 77 completed orders. These are browser captures with real inputs and calculated values; the examples are not calibrated business forecasts.

The PNG previews in `public/previews/` show real rendered example worlds, and `public/previews/templates/` contains the twelve current starter scenes. The social card uses the Little Factory starter preview in an editorial layout. NVIDIA CC BY 4.0 models, Quaternius/Poly Haven CC0 material and the fonts retain the creator/source/licence records linked above.
