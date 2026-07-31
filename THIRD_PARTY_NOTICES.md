# Third-party notices

## Vendored STE dictionary data

`src/dictionary/data/pi-ste.json` is a data-only conversion of the `dictionary/not-approved-word` entries in [`ctotheameron/pi-ste`](https://github.com/ctotheameron/pi-ste), `src/ste/dictionary.gleam`, at commit `18a8cc686be2cc0e680705daf2327fb0d1ef93ce`.
The upstream package and README declare the work to be MIT licensed.
No upstream implementation code is included.

The conversion expands the upstream spelling generators into explicit forms.
Forms produced by upstream helpers named as verb helpers have `VERB` metadata.
Entries without source POS metadata use word-level matching.

The upstream attribution says that its dictionary and rule lists come from [`Ryuketsukami/ste-plain-writing`](https://github.com/Ryuketsukami/ste-plain-writing) and [`danyuchn/asd-ste100-skill`](https://github.com/danyuchn/asd-ste100-skill), both under the MIT License.
The upstream notes also state that ASD owns ASD-STE100 and limits redistribution of its full dictionary.
For that reason, the vendored data contains only the widely cited word and phrase pairs present in the specified pi-ste source file.

## MIT License notices

Copyright (c) 2026 Ege Çelebi
Copyright (c) 2026 Ryuketsukami
Copyright (c) 2026 Dustin Yuchen Teng

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
