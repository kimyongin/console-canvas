# UI sources and local adaptations

Button, Input, Textarea and Badge originate from the official [shadcn/ui new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json). Sources are maintained here, with local import paths and compact console styles. Updates must review the local diff; installation does not silently replace these files.

Tailwind CSS 4 is compiled through PostCSS and the existing esbuild pipeline. Preflight is intentionally omitted. Theme variables are scoped to the editor document's `.cc-ui`; captured content stays inside a separate script-free iframe.

DialogSurface, NativeSelect, ActionMenu and the existing panel resize controller retain native top-layer/focus and persisted sizing behavior. ActionMenu uses the shared shadcn Button. Native modal dialogs avoid a competing portal/focus trap when menus open inside them. React owns their stable markup and list content; the engine owns the scene iframe and uncontrolled form values. These adapters are local components, not unchanged shadcn Dialog/Resizable sources.

MIT License

Copyright (c) 2023 shadcn

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
