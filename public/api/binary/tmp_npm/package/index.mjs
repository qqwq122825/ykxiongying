/**
 * return filesystem path to a prebuilt file
 * @param {string} file 
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * return filesystem path to a prebuilt file
 * @param {string} file 
 */
export function getPrebuilt(file) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, 'prebuilt', file);
}

export function getMinicapSO(abi, sdkLevel) {
    if (!Number.isInteger(sdkLevel)) {
        throw new Error('sdkLevel must be a number');
    }
    return getPrebuilt(`${abi}/lib/android-${sdkLevel}/minicap.so`);
}

export function getMinicapBin(abi, sdkLevel) {
    const minicapName = (sdkLevel >= 16) ? 'minicap' : 'minicap-nopie';
    const binFile = getPrebuilt(`${abi}/bin/${minicapName}`);
    return binFile;
}

export function getMinicapAPK() {
    return getPrebuilt(`noarch/minicap.apk`);
}

/**
 * get scrcpy-server.jar
 * @param {string} version like 1.20, 1.24. 2.0, 3.0.1, 3.3.1
 * @returns 
 */
export function getScrcpyJar(version) {
    return getPrebuilt(`scrcpy/scrcpy-server-v${version}.jar`);
}

export default {
    getPrebuilt,
    getMinicapSO,
    getMinicapBin,
    getMinicapAPK,
    getScrcpyJar
}