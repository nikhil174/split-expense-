// Input from clients is untrusted: a JSON body's fields may be missing or of
// any type until they are checked. Services declare the fields they read.
export type Untrusted<Field extends string> = { readonly [F in Field]?: unknown } | null;
