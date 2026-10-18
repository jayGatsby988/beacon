import { safeNativePath } from '../src/services/NativeIntentPolicy';

/** Applies to cold-start and already-running native links before Expo Router route parsing. */
export function redirectSystemPath({path}: {path:string;initial:boolean}):string {
  return safeNativePath(path);
}
