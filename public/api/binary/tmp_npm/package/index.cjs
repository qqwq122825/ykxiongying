const { resolve } = require('path');

/**
 * Return filesystem path to a prebuilt file using Node's require.resolve mechanism
 * @param {string} file
 * @returns {string}
 */
function getPrebuilt(file) {
  return resolve(__dirname, 'prebuilt', file);
}

function getMinicapSO(abi, sdkLevel) {
  if (!Number.isInteger(sdkLevel)) {
    throw new Error('sdkLevel must be a number');
  }
  return getPrebuilt(`${abi}/lib/android-${sdkLevel}/minicap.so`);
}

function getMinicapBin(abi, sdkLevel) {
  const minicapName = (sdkLevel >= 16) ? 'minicap' : 'minicap-nopie';
  return getPrebuilt(`${abi}/bin/${minicapName}`);
}

function getMinicapAPK() {
  return getPrebuilt(`noarch/minicap.apk`);
}

/**
 * get scrcpy-server.jar
 * @param {string} version like 1.20, 1.24. 2.0, 3.0.1, 3.3.1
 * @returns {string}
 */
function getScrcpyJar(version) {
  return getPrebuilt(`scrcpy/scrcpy-server-v${version}.jar`);
}

module.exports = {
  getPrebuilt,
  getMinicapSO,
  getMinicapBin,
  getMinicapAPK,
  getScrcpyJar
};
