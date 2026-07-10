import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null

  return (
    <Alert variant="destructive">
      <AlertTitle>Authentication failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
