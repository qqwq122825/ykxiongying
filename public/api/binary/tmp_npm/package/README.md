# @u4/minicap-prebuilt

`@u4/minicap-prebuilt` is an superseed of `@devicefarmer/minicap-prebuilt`

it contains:
- minicap builds for android 21 to 30 present in `@devicefarmer/minicap-prebuilt`
- minicap builds for android 32
- Genymobile/scrcpy jar version 1.20, 1.24, 1.25 ..., 3.3.1
- some helper function to access the prebuilt files for ESM and CJS environnement.

## Usage

```js
import { getMinicapSO, getScrcpyJar } from '@u4/minicap-prebuilt';

const minicapSO = getMinicapSO('arm64-v8a', 30);
const scrcpyJar = getScrcpyJar('3.3.1');
```

```js
const prebuilt = require('@u4/minicap-prebuilt');

const minicapSO = prebuilt.getMinicapSO('arm64-v8a', 30);
const scrcpyJar = prebuilt.getScrcpyJar('3.3.1');
```
