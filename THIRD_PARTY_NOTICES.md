# Third-party notices

Inventory checked against the installed packages and `package-lock.json` on 20 October 2026. Versions below describe this checkout; platform-specific optional packages differ on other operating systems. QueueLab's original code is MIT licensed under [LICENSE](LICENSE). Dependencies and the font retain their own licenses.

## Product assets and browser runtime

The miniature worlds use original procedural geometry. No shapez GPL code or assets are copied into QueueLab. DM Sans is served locally from `public/fonts/DMSans.ttf`; its complete SIL Open Font License 1.1 is retained at [`public/fonts/OFL.txt`](public/fonts/OFL.txt). Font copyright: 2014 The DM Sans Project Authors, https://github.com/googlefonts/dm-fonts.

React, React DOM, scheduler and Three.js use the MIT license. Lucide uses ISC and retains MIT notices for icons derived from Feather. Their installed license texts are reproduced below. The headless engine bundle contains QueueLab code and no third-party runtime dependency.

## Installed npm package inventory

`Runtime` is the lockfile's non-dev dependency graph, which can include type-only packages. Development dependencies are not part of the headless bundle. The native Rolldown binding declares MIT in its installed package metadata; its package has no separate license file, so retain the parent Rolldown notices when redistributing that tooling.

| Package | Version | Declared license | Scope | Installed notice file(s) |
| --- | --- | --- | --- | --- |
| `@dimforge/rapier3d-compat` | 0.12.0 | Apache-2.0 | Development | `LICENSE` |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | Development | `LICENSE` |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | Development | `LICENSE` |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | Development | `LICENSE` |
| `@oxc-project/types` | 0.154.0 | MIT | Development | `LICENSE` |
| `@rolldown/binding-darwin-arm64` | 1.2.14 | MIT | Development; optional native | Package metadata; see parent Rolldown notices |
| `@rolldown/pluginutils` | 1.0.1 | MIT | Development | `LICENSE` |
| `@tweenjs/tween.js` | 23.1.3 | MIT | Development | `LICENSE` |
| `@types/chai` | 5.2.3 | MIT | Development | `LICENSE` |
| `@types/deep-eql` | 4.0.2 | MIT | Development | `LICENSE` |
| `@types/estree` | 1.0.9 | MIT | Development | `LICENSE` |
| `@types/node` | 24.19.2 | MIT | Development | `LICENSE` |
| `@types/react` | 19.3.0 | MIT | Runtime | `LICENSE` |
| `@types/react-dom` | 19.3.0 | MIT | Development | `LICENSE` |
| `@types/stats.js` | 0.17.4 | MIT | Development | `LICENSE` |
| `@types/three` | 0.186.0 | MIT | Development | `LICENSE` |
| `@types/webxr` | 0.5.24 | MIT | Development | `LICENSE` |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 | Development; optional native | `LICENSE`, `NOTICE.txt` |
| `@vitejs/plugin-react` | 6.1.2 | MIT | Development | `LICENSE` |
| `@vitest/mocker` | 5.0.5 | MIT | Development | `LICENSE` |
| `@vitest/spy` | 5.0.5 | MIT | Development | `LICENSE` |
| `assertion-error` | 2.0.1 | MIT | Development | `LICENSE` |
| `chai` | 6.3.0 | MIT | Development | `LICENSE` |
| `csstype` | 3.2.3 | MIT | Runtime | `LICENSE` |
| `detect-libc` | 2.1.2 | Apache-2.0 | Development | `LICENSE` |
| `es-module-lexer` | 2.3.2 | MIT | Development | `LICENSE` |
| `estree-walker` | 3.0.3 | MIT | Development | `LICENSE` |
| `expect-type` | 1.4.0 | Apache-2.0 | Development | `LICENSE` |
| `fdir` | 6.5.0 | MIT | Development | `LICENSE` |
| `fflate` | 0.8.3 | MIT | Development | `LICENSE` |
| `fsevents` | 2.3.3 | MIT | Development; optional native | `LICENSE` |
| `lightningcss` | 1.33.0 | MPL-2.0 | Development | `LICENSE` |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | Development; optional native | `LICENSE` |
| `lucide-react` | 1.60.0 | ISC | Runtime | `LICENSE` |
| `magic-string` | 1.4.3 | MIT | Development | `LICENSE` |
| `meshoptimizer` | 1.1.1 | MIT | Development | `LICENSE.md` |
| `nanoid` | 3.3.20 | MIT | Development | `LICENSE` |
| `obug` | 3.0.0 | MIT | Development | `LICENSE` |
| `picocolors` | 1.1.1 | ISC | Development | `LICENSE` |
| `picomatch` | 4.0.7 | MIT | Development | `LICENSE` |
| `playwright` | 1.64.1 | Apache-2.0 | Development | `LICENSE`, `NOTICE`, `ThirdPartyNotices.txt` |
| `playwright-core` | 1.64.1 | Apache-2.0 | Development | `LICENSE`, `NOTICE`, `ThirdPartyNotices.txt` |
| `postcss` | 8.5.31 | MIT | Development | `LICENSE` |
| `react` | 19.3.1 | MIT | Runtime | `LICENSE` |
| `react-dom` | 19.3.1 | MIT | Runtime | `LICENSE` |
| `rolldown` | 1.2.14 | MIT | Development | `LICENSE`, `THIRD-PARTY-LICENSE` |
| `scheduler` | 0.28.0 | MIT | Runtime | `LICENSE` |
| `source-map-js` | 1.2.2 | BSD-3-Clause | Development | `LICENSE` |
| `std-env` | 4.3.0 | MIT | Development | `LICENCE` |
| `three` | 0.186.1 | MIT | Runtime | `LICENSE` |
| `tinybench` | 6.2.2 | MIT | Development | `LICENSE` |
| `tinyexec` | 1.3.1 | MIT | Development | `LICENSE` |
| `tinyglobby` | 0.2.17 | MIT | Development | `LICENSE` |
| `typescript` | 7.0.2 | Apache-2.0 | Development | `LICENSE`, `NOTICE.txt` |
| `undici-types` | 7.24.6 | MIT | Development | `LICENSE` |
| `vite` | 8.3.4 | MIT | Development | `LICENSE.md` |
| `vitest` | 5.0.5 | MIT | Development | `LICENSE.md` |
| `why-is-node-running` | 3.2.1 | MIT | Development | `LICENSE` |

License files in the last column are relative to each installed package directory under `node_modules`. Vite and Rolldown include bundled third-party notices in their license files; Playwright and Playwright Core include `NOTICE` and `ThirdPartyNotices.txt`; TypeScript includes `NOTICE.txt`. Preserve those upstream notices when redistributing development tooling. Lightning CSS and its native binding are MPL-2.0; their installed package metadata points to https://github.com/parcel-bundler/lightningcss for source. They are build tools, not source copied into QueueLab's engine. This inventory records the inspected materials and does not certify every possible redistribution arrangement.

Regenerate the inventory when dependencies or bundled assets change, and inspect the actual license texts rather than inferring permission from a package name.

## Browser runtime license texts

### React / React DOM / scheduler (identical installed MIT text)

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Three.js

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Lucide, including Feather attribution

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DM Sans license

```text
Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
# NVIDIA SimReady asset adaptations

The files in `public/assets/simready/*.glb` are adaptations of NVIDIA's
`furniture_workbench_standard_e01`, `conveyor_belt_a05`, and `pallet_a01`
from [nvidia/simready-assets](https://huggingface.co/datasets/nvidia/simready-assets).
These assets are licensed under **Creative Commons Attribution 4.0 International**,
separately from QueueLab's MIT source license. The complete asset license is
included at `public/assets/simready/LICENSE-CC-BY-4.0.txt` (runtime:
`assets/simready/LICENSE-CC-BY-4.0.txt`).

Modifications: OpenUSD composition, metric coordinate normalization, static
GLB conversion, shared material batches and a local PBR palette. Original
physics, MDL and high-resolution texture payloads are not included in the app.
The pinned dataset revision, source paths, source/output hashes and individual
asset license declarations are recorded in `public/assets/simready/manifest.json`.
See [asset preparation](docs/NVIDIA_ASSETS.md) for the bounded download workflow.
