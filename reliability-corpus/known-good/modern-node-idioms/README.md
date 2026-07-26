# modern-node-idioms

Reliability-corpus fixture: a small, correct, idiomatic ESM Node library.

Every construct here is deliberate and correct. It is scanned by the
GateTest reliability corpus as a **known-good** case, which means any finding
against it is by definition a false positive. See `manifest.json` → `guards`
for the specific regressions this fixture protects against.

## Usage

```js
import { loadConfig, retry } from './src/index.js';

const config = await loadConfig('./');
const data = await retry(() => fetch(config.apiUrl));
```
