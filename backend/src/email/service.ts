export type EmailMessage = {
  to: string
  subject: string
  text: string
}

export type EmailDelivery = {
  configured: boolean
  send(message: EmailMessage, options: { signal: AbortSignal }): Promise<void>
}

export const disabledEmailDelivery: EmailDelivery = {
  configured: false,
  send: async () => undefined,
}
