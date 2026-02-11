interface RuntimeEnv {
  REACT_APP_API_URL?: string;
  REACT_APP_WS_URL?: string;
}

const runtimeEnv = (globalThis as unknown as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};

export function getRuntimeConfig() {
  return {
    apiUrl: runtimeEnv.REACT_APP_API_URL || import.meta.env.VITE_API_URL || '',
    wsUrl: runtimeEnv.REACT_APP_WS_URL || import.meta.env.VITE_GATEWAY_URL || 'ws://localhost:8080',
  };
}
