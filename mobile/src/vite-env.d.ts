/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Server address pre-filled on the Android app's first launch, e.g. http://192.168.1.20:4000. */
  readonly VITE_DEFAULT_SERVER?: string;
}
