// Vite's `?raw` imports (a file's text), used to check that the attribution file is identical in both cores.
declare module '*?raw' {
  const text: string;
  export default text;
}

// Vite's `import.meta.glob` (every spec fixture file, eagerly).
interface ImportMeta {
  glob<T = unknown>(pattern: string, opts: { eager: true; import?: string }): Record<string, T>;
}
