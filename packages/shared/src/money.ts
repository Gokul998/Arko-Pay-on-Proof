/** Money helpers. Amounts travel as decimal strings ("450.00") to match PayPal; math is done in integer cents. */

export const toCents = (amount: string | number): number => Math.round(Number(amount) * 100);

export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

export const formatMoney = (amount: string | number, currency = "USD"): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));

/** Split an amount by a percentage, returning [payee, payer] that always sum to the original. */
export const splitAmount = (amount: string, payeePercent: number): [string, string] => {
  const total = toCents(amount);
  const payee = Math.round((total * payeePercent) / 100);
  return [fromCents(payee), fromCents(total - payee)];
};
