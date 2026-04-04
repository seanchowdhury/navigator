/* @ts-self-types="./navigator_core.d.ts" */

import * as wasm from "./navigator_core_bg.wasm";
import { __wbg_set_wasm } from "./navigator_core_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    find_route
} from "./navigator_core_bg.js";
