const AUTH_RETRY_DELAYS_MS = [250, 750] as const

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type SupabaseUserResult = {
  data?: {
    user?: unknown
  }
  error?: unknown
}

type SupabaseAuthClient = {
  auth: {
    getUser: (token: string) => Promise<SupabaseUserResult>
  }
}

export const getSupabaseUserWithRetry = async (admin: SupabaseAuthClient, token: string) => {
  let lastResult = await admin.auth.getUser(token)
  if (!lastResult.error && lastResult.data?.user) return lastResult

  for (const delay of AUTH_RETRY_DELAYS_MS) {
    await wait(delay)
    lastResult = await admin.auth.getUser(token)
    if (!lastResult.error && lastResult.data?.user) return lastResult
  }

  return lastResult
}
