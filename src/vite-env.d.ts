/// <reference types="vite/client" />

declare module "*.sql?raw" {
  const content: string;
  export default content;
}

declare module "pdfmake/build/vfs_fonts";

interface Navigator {
  readonly deviceMemory?: number;
  readonly gpu?: unknown;
}
