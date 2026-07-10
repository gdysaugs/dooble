export type PurchasePlan = {
  id: string
  label: string
  price: number
  tickets: number
  priceId: string
}

export const PURCHASE_PLANS: PurchasePlan[] = [
  { id: 'starter', label: 'Starter', price: 480, tickets: 25, priceId: 'price_1TrRv7AUadrnZpOslSkWfdPT' },
  { id: 'basic', label: 'Basic', price: 1500, tickets: 80, priceId: 'price_1TrRvKAUadrnZpOsCpXlBTfC' },
  { id: 'plus', label: 'Plus', price: 4000, tickets: 220, priceId: 'price_1TrRvZAUadrnZpOsyZrZgjhz' },
  { id: 'pro', label: 'Pro', price: 15000, tickets: 900, priceId: 'price_1TrRvnAUadrnZpOsfDD4gk2V' },
]
