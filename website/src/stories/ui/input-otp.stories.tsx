import type { Meta, StoryObj } from '@storybook/react-vite'

import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp'
import { DemoSurface } from './demo-surface'

const meta = {
  component: InputOtpDemo,
  title: 'UI/Inputs/Input Otp',
} satisfies Meta<typeof InputOtpDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function InputOtpDemo() {
  return (
    <DemoSurface>
      <InputOTP aria-label="Verification code" maxLength={6}>
        <InputOTPGroup>
          {[0, 1, 2].map((index) => (
            <InputOTPSlot index={index} key={index} />
          ))}
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          {[3, 4, 5].map((index) => (
            <InputOTPSlot index={index} key={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </DemoSurface>
  )
}
