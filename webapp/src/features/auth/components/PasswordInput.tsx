import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState, type ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'> & {
  visibilityLabel?: string
}

export function PasswordInput({
  className,
  id,
  visibilityLabel = 'entered password',
  ...props
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false)
  const actionLabel = `${isVisible ? 'Hide' : 'Show'} ${visibilityLabel}`

  return (
    <div className="relative">
      <Input
        {...props}
        className={cn('pr-10', className)}
        id={id}
        type={isVisible ? 'text' : 'password'}
      />
      <Button
        aria-controls={id}
        aria-label={actionLabel}
        className="absolute top-0 right-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setIsVisible((visible) => !visible)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon
          aria-hidden
          icon={isVisible ? ViewOffIcon : ViewIcon}
          strokeWidth={2}
        />
      </Button>
    </div>
  )
}
