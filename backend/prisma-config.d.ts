declare module 'prisma/config' {
  export function defineConfig(config: any): any
  export function env(key: string): string
}