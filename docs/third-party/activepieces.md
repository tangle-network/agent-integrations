# Activepieces Community Catalog Attribution

`src/activepieces-catalog.generated.ts` is generated from the Activepieces
Community pieces catalog:

- Source repository: https://github.com/activepieces/activepieces
- Source path: `packages/pieces/community`
- License: MIT
- Imported surface: piece ids, display names, descriptions, package names,
  versions, high-level action names, trigger names, auth shape hints, and
  category/domain metadata.

The generated catalog is connector metadata for `agent-integrations`; it does
not vendor the Activepieces runtime or execute Activepieces piece code directly.
Consumers can run these connectors through an Activepieces-backed provider,
promote selected entries to first-party adapters, or use the metadata for
planning and connection setup.

Regenerate after checking out Activepieces:

```sh
ACTIVEPIECES_ROOT=/path/to/activepieces node scripts/import-activepieces-catalog.mjs
```

## Upstream License Notice

Copyright (c) 2020-2024 Activepieces Inc.

Portions of this software are licensed as follows:

- All content that resides under the "packages/ee/" and
  "packages/server/api/src/app/ee" directory of this repository, if that
  directory exists, is licensed under the license defined in
  packages/ee/LICENSE.
- All third party components incorporated into the Activepieces Inc Software
  are licensed under the original license provided by the owner of the
  applicable component.
- Content outside of the above mentioned directories or restrictions above is
  available under the "MIT Expat" license as defined below.

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
