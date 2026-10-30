// `ms` 2 ships no types: the one call shape the driver uses
declare module "ms" {
  function ms(value: string): number;
  export = ms;
}
