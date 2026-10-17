/**
 * A shared response type as a service builds it: the named fields still hold the Dates the
 * database returns, which the JSON response writes as the ISO strings the shared type declares.
 * It lets a service declare the response contract without converting rows it returns as they are.
 */
export type Unserialized<T, DateField extends keyof T> = { [K in keyof T]: K extends DateField ? DateOf<T[K]> : T[K] };

type DateOf<V> = V extends string ? Date : V;
