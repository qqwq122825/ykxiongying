/**
 * Returns the absolute filesystem path to a prebuilt resource file.
 *
 * @param file - The relative path to the prebuilt resource (e.g. "noarch/minicap.apk")
 * @returns The absolute filesystem path to the requested resource.
 */
/**
 * Returns the absolute filesystem path to a prebuilt resource file.
 * @param file - The relative path to the prebuilt resource (e.g. "noarch/minicap.apk")
 * @returns The absolute filesystem path to the requested resource.
 */
export declare function getPrebuilt(file: string): string;

/**
 * Returns the path to the minicap.so library for the given ABI and SDK level.
 * @param abi - The Android ABI (e.g. "arm64-v8a")
 * @param sdkLevel - The Android SDK level (number)
 * @returns The absolute path to the minicap.so file.
 */
export declare function getMinicapSO(abi: string, sdkLevel: number): string;

/**
 * Returns the path to the minicap binary for the given ABI and SDK level.
 * @param abi - The Android ABI (e.g. "arm64-v8a")
 * @param sdkLevel - The Android SDK level (number)
 * @returns The absolute path to the minicap binary.
 */
export declare function getMinicapBin(abi: string, sdkLevel: number): string;

/**
 * Returns the path to the minicap APK.
 * @returns The absolute path to the minicap.apk file.
 */
export declare function getMinicapAPK(): string;

/**
 * Returns the path to the scrcpy-server.jar for the given version.
 * @param version - The scrcpy version (e.g. "1.20", "2.0", "3.3.1")
 * @returns The absolute path to the scrcpy-server.jar file.
 */
export declare function getScrcpyJar(version: string): string;
