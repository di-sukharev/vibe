import {
  ComputerIcon,
  Logout01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Typography } from '@/components/typography'

export function SessionPanel({ onLogout }: { onLogout: () => Promise<void> }) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutFailed, setLogoutFailed] = useState(false)

  async function logout() {
    setIsLoggingOut(true)
    setLogoutFailed(false)
    try {
      await onLogout()
    } catch {
      setLogoutFailed(true)
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <Typography as="h2" variant="h6">
          Current session
        </Typography>
        <CardDescription>
          Review this browser session or sign out when you are finished.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon">
            <HugeiconsIcon aria-hidden icon={ComputerIcon} strokeWidth={2} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>This browser</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Badge variant="outline">Active</Badge>
          </ItemActions>
        </Item>

        {logoutFailed && (
          <Alert variant="destructive">
            <AlertTitle>Logout failed</AlertTitle>
            <AlertDescription>Your session is still active. Please try again.</AlertDescription>
          </Alert>
        )}

        <div>
          <Button
            disabled={isLoggingOut}
            onClick={() => void logout()}
            type="button"
            variant="outline"
          >
            <HugeiconsIcon
              aria-hidden
              data-icon="inline-start"
              icon={Logout01Icon}
              strokeWidth={2}
            />
            {isLoggingOut ? 'Logging out…' : 'Logout'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
