// ws3-fca ships no TypeScript declarations. We only need a callback-style
// login() call and then treat the returned `api` object as loosely-typed —
// same as the rest of the fca-unofficial-fork ecosystem, none of which
// publishes a fully accurate type surface for their internal Facebook API.
declare module "ws3-fca" {
  export function login(
    credentials: Record<string, any>,
    options: Record<string, any>,
    callback: (err: any, api: any) => void,
  ): void;
}
