export type PurchasePlan = {
  id: string
  label: string
  price: number
  tickets: number
  priceId: string
}

export const PURCHASE_PLANS: PurchasePlan[] = [
  { id: 'starter', label: 'Starter', price: 480, tickets: 25, priceId: 'price_1TCz5nA9KcmC9XImyo6sNLGa' },
  { id: 'basic', label: 'Basic', price: 1500, tickets: 80, priceId: 'price_1TCz67A9KcmC9XImBOK1rmiV' },
  { id: 'plus', label: 'Plus', price: 4000, tickets: 220, priceId: 'price_1TCz6MA9KcmC9XImMNMlFeGO' },
  { id: 'pro', label: 'Pro', price: 15000, tickets: 900, priceId: 'price_1TCz6iA9KcmC9XImkYYhJeQR' },
]
